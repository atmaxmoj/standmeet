// Package blockseam — a block-backed seam provider.
//
// Any block that `provides` a seam is served the SAME way, with no per-provider code: dial the
// block, merge the owner's opaque stored credentials into the verb's args, call the verb as one of
// the block's tools. This is generic — it names no block and no seam (no "caldav", no "calendar").
// It is a seamctx.Provider (CallVerb): a block that provides a seam becomes, uniformly, the value
// the owner's seam context resolves to. Replaces the per-provider blockCalendarProxy that lived in
// the composition root.
package blockseam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// CredVault — the owner's opaque stored connect-form values for a block, as a JSON object. The host
// does not decode the fields; the block's manifest `config` declares them, the block consumes them.
type CredVault interface {
	Credentials(ctx context.Context, blockID, ownerID string) (json.RawMessage, error)
}

// Session — the dialed block, narrowed to what a seam call needs. *mcpclient.Session satisfies it;
// a test supplies a fake, so this provider is unit-testable with no sandbox.
type Session interface {
	CallToolChecked(
		ctx context.Context, name string, args json.RawMessage,
		sctx *mcpclient.SessionContext, budget time.Duration,
	) (mcpclient.ToolOutcome, error)
	Close()
}

// Dial — open a session to a block. The composition root injects mount.DialBlock; a test injects a
// fake. Keeping it injected is why this package does not depend on mount.
type Dial func(ctx context.Context, m *plugin.Manifest) (Session, error)

// Provider — a block-backed seam provider. Holds the manifest (to dial), the credential vault, and
// the dial function.
type Provider struct {
	vault    CredVault
	dial     Dial
	manifest plugin.Manifest
}

// New — a block-backed provider for one block.
func New(m *plugin.Manifest, vault CredVault, dial Dial) *Provider {
	return &Provider{vault: vault, dial: dial, manifest: *m}
}

// CallVerb — the seamctx.Provider surface: run one verb on the block. Merge creds → dial → call the
// verb as a tool. A dial/call failure or a tool-level error is an "unavailable" fault (configured,
// but can't right now — never "not configured", which the seam reports when nobody provides).
func (p *Provider) CallVerb(
	ctx context.Context, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	creds, cerr := p.vault.Credentials(ctx, p.manifest.ID, ownerID)
	if cerr != nil {
		return nil, unavailable(fmt.Errorf("block %q credentials: %w", p.manifest.ID, cerr))
	}
	merged, merr := mergeJSONObjects(creds, args)
	if merr != nil {
		return nil, unavailable(merr)
	}
	return p.dialAndCall(ctx, verb, merged)
}

// dialAndCall — dial the block, call the verb as a tool, and map any failure (dial, transport, or a
// tool-level IsError) to an `unavailable` fault. Split from CallVerb so each stays under the branch
// cap; the credential/merge half is CallVerb's, the block round-trip is here.
func (p *Provider) dialAndCall(
	ctx context.Context, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	tDial := time.Now()
	sess, derr := p.dial(ctx, &p.manifest)
	dialMS := time.Since(tDial).Milliseconds()
	if derr != nil {
		return nil, unavailable(fmt.Errorf("dial block %q: %w", p.manifest.ID, derr))
	}
	defer sess.Close()
	tCall := time.Now()
	out, terr := sess.CallToolChecked(ctx, verb, args, nil, 0)
	// A seam op cold-spawns a fresh sandbox per call (sandbox-lives-one-turn), and that spawn +
	// MCP `initialize` is the dominant, variable latency on every booking / mail / calendar op —
	// the first thing to look at when one is slow, in prod as much as in a test. Log the split on
	// every call so it is answerable from the logs alone (dial_ms = cold sandbox spawn+init,
	// call_ms = the verb's own work) without attaching a profiler to a live instance.
	slog.Default().Info("blockseam call",
		"block", p.manifest.ID, "verb", verb, "dial_ms", dialMS,
		"call_ms", time.Since(tCall).Milliseconds())
	if terr != nil {
		return nil, unavailable(fmt.Errorf("dial block %q %s: %w", p.manifest.ID, verb, terr))
	}
	if out.IsError {
		// A tool-level IsError is the block's DELIBERATE, user-facing message: a block owns its own
		// error classification (e.g. the SMTP block's friendly auth/tls/connect sentence). Keep it
		// verbatim, with no "block X verb:" prefix, so the admin/card surfaces the block's own
		// sentence (verifyReason reads a fault's message). Transport failures above keep the
		// diagnostic prefix — they are infra, not a block's chosen words.
		//
		// A block may lead its error with a "[fault:<code>]" token to name its fault CLASS (a mail
		// block marks a 5xx rejection "rejected", so the host says "change the recipient" not "try
		// again"). The token is stripped from the sentence; no token ⇒ the retryable class.
		return nil, toolFault(out.Text)
	}
	return json.RawMessage(out.Text), nil
}

func unavailable(err error) error {
	return &hostop.FaultError{Code: hostop.FaultUnavailable, Err: err}
}

// faultCodeOf — a block's fault token → the host fault class. "rejected" (permanent, change input)
// and "revoked" (grant gone, reconnect) are the two non-retryable classes; anything else is the
// retryable "unavailable" class.
func faultCodeOf(tok string) string {
	switch tok {
	case hostop.FaultRejected:
		return hostop.FaultRejected
	case hostop.FaultRevoked:
		return hostop.FaultRevoked
	default:
		return hostop.FaultUnavailable
	}
}

// toolFault — turn a block's tool-error text into a classified fault. An optional leading
// "[fault:<code>]" token names the class: "rejected" (permanent, change the input) and "revoked"
// (the grant is gone, reconnect) are honored as distinct non-retryable classes; anything else, or
// no token, is the retryable "unavailable" class. The token is stripped so the surfaced sentence is
// the block's own words.
func toolFault(text string) error {
	// mcpclient frames an error tool result as "[error] <message>" (client.go). Strip that first so
	// the fault token — and the surfaced sentence — are the block's own words.
	text = strings.TrimPrefix(text, "[error] ")
	after, ok := strings.CutPrefix(text, "[fault:")
	if !ok {
		return unavailable(errors.New(text))
	}
	tok, rest, found := strings.Cut(after, "] ")
	if !found {
		return unavailable(errors.New(text))
	}
	return &hostop.FaultError{Code: faultCodeOf(tok), Err: errors.New(rest)}
}

// mergeJSONObjects — the owner's opaque creds as the base, the verb's args merged on top. Both are
// JSON objects; an empty/null side contributes nothing. Merged at the JSON level so the host never
// names a field.
func mergeJSONObjects(base, over json.RawMessage) (json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	for _, part := range []json.RawMessage{base, over} {
		if err := mergeInto(out, part); err != nil {
			return nil, err
		}
	}
	if len(out) == 0 {
		return over, nil // nothing to merge — hand back the args unchanged
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("merge args: %w", err)
	}
	return b, nil
}

// mergeInto — copy one JSON object's fields into out. An empty/null part contributes nothing.
func mergeInto(out map[string]json.RawMessage, part json.RawMessage) error {
	if len(part) == 0 || string(part) == "null" {
		return nil
	}
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(part, &m); err != nil {
		return fmt.Errorf("merge args: %w", err)
	}
	maps.Copy(out, m)
	return nil
}
