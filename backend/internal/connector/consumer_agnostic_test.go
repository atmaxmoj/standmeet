// consumer_agnostic_test.go — guard: connector is a **consumer-agnostic, bidirectional** base.
//
// Motivation (see hub.go for detail): pull the connector layer down to a **fully non-MCP**
// consumption path + **bidirectional** (read+write), locking down two things no later change may
// break:
//
//  1. A consumer that **does not import capreg (the MCP package)** — here, fakeGateway, standing
//     in for a future IM Gateway / task orchestrator — can still resolve a connector by name and
//     use it both ways. This test file's import list has **no capreg**, which is the
//     compile-time proof that the connector layer is fully decoupled from MCP.
//
//  2. Credentials never leave the connector: what the Gateway / agent side gets is a handle
//     (Connector + capability interface), and neither read nor write leaks a token / secret —
//     the handle's surface has no method that extracts credentials at all.
//
// Scenario (owner is @-mentioned in an IM → Gateway wakes the agent → agent consumes channel
// history using the connector's credentials, then replies with the same credentials):
//
//	IM Gateway ──wakes──> agent
//	                      │ ① ReadChannel: consume channel history via connector creds
//	                      │ ② Send: reply to the channel via the same creds
//	                      ▼
//	                 discord connector (holds the bot token, bidirectional, creds stay internal)
//
// One base, multiple consumers: capreg's enabledCaps gate is "the MCP consumer"; this test is
// "the IM Gateway consumer" — both will share the same Hub eventually.

package connector_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/stretchr/testify/require"
)

var (
	errNoConnector  = errors.New("gateway: discord connector not registered")
	errNotMessenger = errors.New("gateway: discord connector is not a messenger")
)

// fakeDiscord — a **bidirectional** IM connector: holds a bot token (creds live only inside the
// connector), can read channel history + send messages. Externally (on the handle surface) it
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

// messenger — the capability interface (read + write) an IM connector presents to a consumer.
// A consumer resolves a connector.Connector by name, then type-asserts it to this. **The
// interface has no credential getter at all**.
type messenger interface {
	ReadChannel(ctx context.Context, ownerID, channel string) ([]string, error)
	Send(ctx context.Context, ownerID, channel, msg string) error
}

// fakeGateway — stands in for a future IM Gateway / task orchestrator: owner is @-mentioned in
// an IM, waking it up → consumes channel history into context via connector creds → (agent
// processes it) → replies using the same creds (never touches MCP / capreg throughout).
type fakeGateway struct{ hub *connector.Hub }

func (g *fakeGateway) handleMention(
	ctx context.Context, owner, channel, agentReply string,
) ([]string, error) {
	c, ok := g.hub.Resolve("discord")
	if !ok {
		return nil, errNoConnector
	}
	im, ok := c.(messenger)
	if !ok {
		return nil, errNotMessenger
	}
	history, err := im.ReadChannel(ctx, owner, channel) // ① consume channel history via creds
	if err != nil {
		return nil, fmt.Errorf("gateway read: %w", err)
	}
	if serr := im.Send(ctx, owner, channel, agentReply); serr != nil { // ② send back via same creds
		return nil, fmt.Errorf("gateway send: %w", serr)
	}
	return history, nil
}

func TestConnector_ConsumerAgnostic_BidirectionalGateway(t *testing.T) {
	t.Parallel()
	disc := &fakeDiscord{
		botToken: "super-secret-bot-token",
		history:  map[string][]string{"#general": {"hi", "anyone around?"}},
		sent:     map[string][]string{},
	}
	hub := connector.NewHub()
	hub.Register(disc)

	gw := &fakeGateway{hub: hub}
	history, err := gw.handleMention(
		context.Background(), "owner-1", "#general", "hello from the agent",
	)
	require.NoError(t, err)

	// Both directions work: read got the channel history (into agent context)…
	require.Equal(t, []string{"hi", "anyone around?"}, history,
		"agent read channel history via the connector creds")
	// …and send sent the reply out.
	require.Equal(t, []string{"hello from the agent"}, disc.sent["#general"],
		"agent sent the reply back via the same creds")

	// No credential leak: the handle the Gateway got (the messenger interface) exposes no
	// method that extracts the token.
	assertHandleHasNoCredGetter(t, reflect.TypeFor[messenger]())
	assertHandleHasNoCredGetter(t, reflect.TypeFor[connector.Connector]())
}

var credRe = regexp.MustCompile(`(?i)token|secret|password|credential|apikey`)

func assertHandleHasNoCredGetter(t *testing.T, iface reflect.Type) {
	t.Helper()
	for m := range iface.Methods() {
		require.Falsef(t, credRe.MatchString(m.Name),
			"connector handle %s exposes credential method %q (creds stay inside)", iface, m.Name)
	}
}
