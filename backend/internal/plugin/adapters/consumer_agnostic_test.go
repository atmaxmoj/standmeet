// consumer_agnostic_test.go — guard: a supplier is a **consumer-agnostic, bidirectional** base.
//
// Motivation: keep the supplier layer on a **fully non-MCP** consumption path +
// **bidirectional** (read+write), locking down two things no later change may break:
//
//  1. A consumer that **does not import the registry (the MCP package)** — here, fakeGateway,
//     standing in for a future IM Gateway / task orchestrator — can still resolve a supplier by
//     name and use it both ways. This test file's import list has **no registry**, which is the
//     compile-time proof that the supplier layer is fully decoupled from MCP.
//
//  2. Credentials never leave the supplier: what the Gateway / agent side gets is a handle
//     (Supplier + the seam's own interface), and neither read nor write leaks a token / secret —
//     the handle's surface has no method that extracts credentials at all.
//
// Scenario (owner is @-mentioned in an IM → Gateway wakes the agent → agent consumes channel
// history using the supplier's credentials, then replies with the same credentials):
//
//	IM Gateway ──wakes──> agent
//	                      │ ① ReadChannel: consume channel history via supplier creds
//	                      │ ② Send: reply to the channel via the same creds
//	                      ▼
//	                 discord supplier (holds the bot token, bidirectional, creds stay internal)
//
// One base, multiple consumers: the registry's enabledBlocks gate is "the MCP consumer"; this
// test is "the IM Gateway consumer" — both resolve through the same lookup.

// The guard is that NO registry type is needed. An in-package test can still prove that,
// because the import list is what carries the proof.

package adapters

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

var (
	errNoSupplier   = errors.New("gateway: discord supplier not registered")
	errNotMessenger = errors.New("gateway: discord supplier is not a messenger")
)

// fakeDiscord — a **bidirectional** IM supplier: holds a bot token (creds live only inside the
// supplier), can read channel history + send messages. Externally (on the handle surface) it
// **has no method that extracts the token**.
type fakeDiscord struct {
	history  map[string][]string
	sent     map[string][]string
	botToken string
}

func (*fakeDiscord) Name() string { return "discord" }
func (*fakeDiscord) Kind() string { return "protocol" }

func (d *fakeDiscord) Connected(_ context.Context, _ string) (bool, error) {
	return d.botToken != "", nil
}

// ReadChannel — call the IM API with botToken to pull channel history (the real call is omitted
// here).
func (d *fakeDiscord) ReadChannel(_ context.Context, _, channel string) ([]string, error) {
	_ = d.botToken // credential used internally
	return d.history[channel], nil
}

// Send — use botToken to send a message back to the channel.
func (d *fakeDiscord) Send(_ context.Context, _, channel, msg string) error {
	_ = d.botToken
	d.sent[channel] = append(d.sent[channel], msg)
	return nil
}

// messenger — the seam interface (read + write) an IM supplier presents to a consumer.
// A consumer resolves a Supplier by name, then type-asserts it to this. **The
// interface has no credential getter at all**.
type messenger interface {
	ReadChannel(ctx context.Context, ownerID, channel string) ([]string, error)
	Send(ctx context.Context, ownerID, channel, msg string) error
}

// fakeGateway — stands in for a future IM Gateway / task orchestrator: owner is @-mentioned in
// an IM, waking it up → consumes channel history into context via supplier creds → (agent
// processes it) → replies using the same creds (never touches MCP / the registry throughout).
type fakeGateway struct{ lookup LookupSupplier }

func (g *fakeGateway) handleMention(
	ctx context.Context, owner, channel, agentReply string,
) ([]string, error) {
	sup, err := g.imSupplier(ctx, owner)
	if err != nil {
		return nil, err
	}
	im, ok := sup.(messenger)
	if !ok {
		return nil, errNotMessenger
	}
	history, rerr := im.ReadChannel(ctx, owner, channel) // ① consume channel history via creds
	if rerr != nil {
		return nil, fmt.Errorf("gateway read: %w", rerr)
	}
	if serr := im.Send(ctx, owner, channel, agentReply); serr != nil { // ② send via same creds
		return nil, fmt.Errorf("gateway send: %w", serr)
	}
	return history, nil
}

// imSupplier — resolution is BY NAME. There is no registry type here, no registry import,
// and nothing typed about how the supplier is found — which is the whole property this file
// has always guarded, now stated by the mechanism instead of by a Hub.
//
// It hands back the Supplier, not a messenger: the type assertion stays at the point of use,
// which is where the caller decides what shape it needs. Resolving straight to a typed handle
// is the accessor shape the block model deletes.
func (g *fakeGateway) imSupplier(ctx context.Context, owner string) (Supplier, error) {
	c, err := g.lookup(ctx, owner, "im")
	if err != nil || c == nil {
		return nil, errNoSupplier
	}
	return c, nil
}

func TestSupplier_ConsumerAgnostic_BidirectionalGateway(t *testing.T) {
	t.Parallel()
	disc := &fakeDiscord{
		botToken: "super-secret-bot-token",
		history:  map[string][]string{"#general": {"hi", "anyone around?"}},
		sent:     map[string][]string{},
	}
	gw := &fakeGateway{
		lookup: func(_ context.Context, _, seam string) (Supplier, error) {
			if seam != "im" {
				return nil, nil
			}
			return disc, nil
		},
	}
	history, err := gw.handleMention(
		context.Background(), "owner-1", "#general", "hello from the agent",
	)
	require.NoError(t, err)

	// Both directions work: read got the channel history (into agent context)…
	require.Equal(t, []string{"hi", "anyone around?"}, history,
		"agent read channel history via the supplier creds")
	// …and send sent the reply out.
	require.Equal(t, []string{"hello from the agent"}, disc.sent["#general"],
		"agent sent the reply back via the same creds")

	// No credential leak: the handle the Gateway got (the messenger interface) exposes no
	// method that extracts the token.
	assertHandleHasNoCredGetter(t, reflect.TypeFor[messenger]())
	assertHandleHasNoCredGetter(t, reflect.TypeFor[Supplier]())
}

var credRe = regexp.MustCompile(`(?i)token|secret|password|credential|apikey`)

func assertHandleHasNoCredGetter(t *testing.T, iface reflect.Type) {
	t.Helper()
	for m := range iface.Methods() {
		require.Falsef(t, credRe.MatchString(m.Name),
			"supplier handle %s exposes credential method %q (creds stay inside)", iface, m.Name)
	}
}
