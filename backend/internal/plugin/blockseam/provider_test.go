// provider_test.go — the contract of the block-backed seam provider, unit-tested with fakes (no
// sandbox, no DB). This is the primitive the supplier-fold collapses onto: every seam provider is
// "merge the owner's stored creds into the verb args → dial the block → call the verb as a tool",
// with a dial/call/tool failure surfacing as an `unavailable` fault (configured, can't right now) —
// never "not configured". Locking it here means the fold's consumers can rely on it before the
// wiring that replaces the typed proxies exists.

package blockseam_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockseam"
)

const (
	owner    = "o"  // the owner id the failure-path tests call under (value irrelevant to them)
	emptyObj = "{}" // an empty JSON object, as args or a tool result
	verb     = "v"  // the verb name the tests call (value irrelevant to them)
)

// ── fakes ───────────────────────────────────────────────────────────────────

type fakeVault struct {
	err                  error
	gotBlockID, gotOwner string
	creds                json.RawMessage
}

func (v *fakeVault) Credentials(
	_ context.Context, blockID, ownerID string,
) (json.RawMessage, error) {
	v.gotBlockID, v.gotOwner = blockID, ownerID
	return v.creds, v.err
}

type fakeSession struct {
	out     mcpclient.ToolOutcome
	callErr error
	gotName string
	gotArgs json.RawMessage
	closed  bool
}

func (s *fakeSession) CallToolChecked(
	_ context.Context, name string, args json.RawMessage,
	_ *mcpclient.SessionContext, _ time.Duration,
) (mcpclient.ToolOutcome, error) {
	s.gotName, s.gotArgs = name, args
	return s.out, s.callErr
}

func (s *fakeSession) Close() { s.closed = true }

func manifest() *plugin.Manifest { return &plugin.Manifest{ID: "acme-cal"} }

// dialTo — a Dial that always hands back sess (and records that it was called).
func dialTo(sess blockseam.Session, called *bool) blockseam.Dial {
	return func(context.Context, *plugin.Manifest) (blockseam.Session, error) {
		if called != nil {
			*called = true
		}
		return sess, nil
	}
}

// unmarshalObj — the merged args as a field→raw-JSON map (no `any`; compare fields with JSONEq).
func unmarshalObj(t *testing.T, raw json.RawMessage) map[string]json.RawMessage {
	t.Helper()
	m := map[string]json.RawMessage{}
	require.NoError(t, json.Unmarshal(raw, &m))
	return m
}

func requireUnavailable(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	var fe *hostop.FaultError
	require.ErrorAs(t, err, &fe, "a block-backed seam failure must be a FaultError")
	require.Equal(t, hostop.FaultUnavailable, fe.Code,
		"configured-but-can't-right-now is `unavailable`, never `not configured`")
}

// ── tests ───────────────────────────────────────────────────────────────────

// Happy: the owner's stored creds are merged UNDER the verb args, the verb is called as a tool by
// name, the block is dialed once and closed, and the tool's text is the returned value. The vault
// is keyed by the block's own id + the owner.
func TestCallVerb_MergesCredsDialsAndReturnsText(t *testing.T) {
	t.Parallel()
	vault := &fakeVault{creds: json.RawMessage(`{"api_key":"secret","host":"cal.example"}`)}
	sess := &fakeSession{out: mcpclient.ToolOutcome{Text: `{"ok":true}`}}
	var dialed bool
	p := blockseam.New(manifest(), vault, dialTo(sess, &dialed))

	got, err := p.CallVerb(context.Background(), "owner-1", "free_busy",
		json.RawMessage(`{"from":"2026-01-01"}`))
	require.NoError(t, err)
	require.JSONEq(t, `{"ok":true}`, string(got), "the tool's text is the seam result")

	require.True(t, dialed, "the block was dialed")
	require.True(t, sess.closed, "the session was closed (sandbox lives one turn)")
	require.Equal(t, "acme-cal", vault.gotBlockID, "vault keyed by the block's own id")
	require.Equal(t, "owner-1", vault.gotOwner)
	require.Equal(t, "free_busy", sess.gotName, "the verb is called as a tool by name")

	merged := unmarshalObj(t, sess.gotArgs)
	require.JSONEq(t, `"secret"`, string(merged["api_key"]), "stored cred merged into the call")
	require.JSONEq(t, `"cal.example"`, string(merged["host"]))
	require.JSONEq(t, `"2026-01-01"`, string(merged["from"]), "the verb's own args ride alongside")
}

// REUSE (RED until the keep-alive pool lands): the dominant cost of a seam op is the COLD dial —
// each call cold-spawns a bwrap+node sandbox whose node_modules is read over the dev bind-mount
// (~7-10s, docs/full-suite-failures.md). sandbox-lives-one-turn is relaxed to a per-(block,owner)
// keep-alive: two sequential verbs for the SAME owner reuse ONE warm sandbox, so a booking's
// free_busy+insert_event pays one dial, not two. A DIFFERENT owner never shares a sandbox
// (creds/native-key isolation — the conservative-safe key). This flips the `sess.closed` assertion
// in TestCallVerb_MergesCredsDialsAndReturnsText, which locked the old per-turn-close contract.
func TestCallVerb_ReusesWarmSandboxPerOwner(t *testing.T) {
	t.Skip("test-first RED: the per-(block,owner) keep-alive pool is not implemented yet " +
		"(memory eiab-build-progress.md, 2026-09-20). Unskip when the reuse pool lands.")
	t.Parallel()
	vault := &fakeVault{creds: json.RawMessage(emptyObj)}
	var dials int
	dial := func(context.Context, *plugin.Manifest) (blockseam.Session, error) {
		dials++
		return &fakeSession{out: mcpclient.ToolOutcome{Text: emptyObj}}, nil
	}
	p := blockseam.New(manifest(), vault, dial)
	ctx := context.Background()

	_, err := p.CallVerb(ctx, "owner-A", "free_busy", json.RawMessage(emptyObj))
	require.NoError(t, err)
	_, err = p.CallVerb(ctx, "owner-A", "insert_event", json.RawMessage(emptyObj))
	require.NoError(t, err)
	require.Equal(t, 1, dials, "two verbs, one owner: one dial (reused), not two")

	_, err = p.CallVerb(ctx, "owner-B", "free_busy", json.RawMessage(emptyObj))
	require.NoError(t, err)
	require.Equal(t, 2, dials, "a different owner never shares a sandbox")
}

// The verb args win over a colliding cred key (args are the caller's intent; creds are the base).
// Both carry `account`; the arg value must survive.
func TestCallVerb_ArgsOverrideCollidingCred(t *testing.T) {
	t.Parallel()
	vault := &fakeVault{creds: json.RawMessage(`{"account":"from-vault"}`)}
	sess := &fakeSession{out: mcpclient.ToolOutcome{Text: emptyObj}}
	p := blockseam.New(manifest(), vault, dialTo(sess, nil))

	_, err := p.CallVerb(context.Background(), owner, "book",
		json.RawMessage(`{"account":"from-args"}`))
	require.NoError(t, err)
	merged := unmarshalObj(t, sess.gotArgs)
	require.JSONEq(t, `"from-args"`, string(merged["account"]), "the arg overrides the base cred")
}

// Empty/absent creds contribute nothing — the verb still gets its own args (a block with no
// owner-entered credential is legal).
func TestCallVerb_NoCreds_PassesArgsThrough(t *testing.T) {
	t.Parallel()
	vault := &fakeVault{creds: nil}
	sess := &fakeSession{out: mcpclient.ToolOutcome{Text: emptyObj}}
	p := blockseam.New(manifest(), vault, dialTo(sess, nil))

	_, err := p.CallVerb(context.Background(), owner, "ping", json.RawMessage(`{"x":1}`))
	require.NoError(t, err)
	merged := unmarshalObj(t, sess.gotArgs)
	require.JSONEq(t, `1`, string(merged["x"]), "the verb's args pass through with no creds")
}

// A credential-vault failure is `unavailable` — and the block is never dialed (nothing to call).
func TestCallVerb_VaultError_UnavailableNoDial(t *testing.T) {
	t.Parallel()
	vault := &fakeVault{err: errors.New("vault down")}
	var dialed bool
	p := blockseam.New(manifest(), vault, dialTo(&fakeSession{}, &dialed))

	_, err := p.CallVerb(context.Background(), owner, verb, json.RawMessage(emptyObj))
	requireUnavailable(t, err)
	require.False(t, dialed, "a vault failure short-circuits before the dial")
}

// A dial failure is `unavailable` (the block is configured, just unreachable this moment).
func TestCallVerb_DialError_Unavailable(t *testing.T) {
	t.Parallel()
	p := blockseam.New(manifest(), &fakeVault{creds: json.RawMessage(emptyObj)},
		func(context.Context, *plugin.Manifest) (blockseam.Session, error) {
			return nil, errors.New("sandbox won't start")
		})
	_, err := p.CallVerb(context.Background(), owner, verb, json.RawMessage(emptyObj))
	requireUnavailable(t, err)
}

// A transport error from the tool call is `unavailable`, and the session is still closed.
func TestCallVerb_CallError_UnavailableAndClosed(t *testing.T) {
	t.Parallel()
	sess := &fakeSession{callErr: errors.New("broken pipe")}
	p := blockseam.New(manifest(), &fakeVault{creds: json.RawMessage(emptyObj)}, dialTo(sess, nil))

	_, err := p.CallVerb(context.Background(), owner, verb, json.RawMessage(emptyObj))
	requireUnavailable(t, err)
	require.True(t, sess.closed, "the session is closed even on a call error")
}

// A tool-level error (IsError) — the block answered, but with a failure — is `unavailable`, not a
// silent success. Its text must not be returned as a result.
func TestCallVerb_ToolIsError_Unavailable(t *testing.T) {
	t.Parallel()
	sess := &fakeSession{out: mcpclient.ToolOutcome{Text: "rate limited", IsError: true}}
	p := blockseam.New(manifest(), &fakeVault{creds: json.RawMessage(emptyObj)}, dialTo(sess, nil))

	got, err := p.CallVerb(context.Background(), owner, verb, json.RawMessage(emptyObj))
	requireUnavailable(t, err)
	require.Nil(t, got, "a tool error returns no result value")
}

// A block can lead its tool error with a "[fault:rejected]" token to name a PERMANENT failure — the
// mail block does this for a 5xx relay reply so the host says "change the recipient", not "try
// again". The token sets the fault code and is stripped from the surfaced sentence.
func TestCallVerb_ToolIsError_RejectedToken(t *testing.T) {
	t.Parallel()
	// mcpclient frames an error result as "[error] <message>"; the block's token rides after it.
	sess := &fakeSession{out: mcpclient.ToolOutcome{
		Text: "[error] [fault:rejected] the mail server refused this message", IsError: true,
	}}
	p := blockseam.New(manifest(), &fakeVault{creds: json.RawMessage(emptyObj)}, dialTo(sess, nil))

	_, err := p.CallVerb(context.Background(), owner, verb, json.RawMessage(emptyObj))
	require.Error(t, err)
	var fe *hostop.FaultError
	require.ErrorAs(t, err, &fe)
	require.Equal(t, hostop.FaultRejected, fe.Code, "[fault:rejected] names a permanent class")
	require.Equal(t, "the mail server refused this message", fe.Err.Error(),
		"the [error] frame and token are stripped; the block's sentence is surfaced")
}

// An unknown or malformed fault token is NOT a distinct class — it falls back to the retryable
// `unavailable` class (a block can't invent a code the host doesn't act on).
func TestCallVerb_ToolIsError_UnknownTokenIsUnavailable(t *testing.T) {
	t.Parallel()
	sess := &fakeSession{out: mcpclient.ToolOutcome{Text: "[fault:bogus] whatever", IsError: true}}
	p := blockseam.New(manifest(), &fakeVault{creds: json.RawMessage(emptyObj)}, dialTo(sess, nil))

	_, err := p.CallVerb(context.Background(), owner, verb, json.RawMessage(emptyObj))
	requireUnavailable(t, err)
}
