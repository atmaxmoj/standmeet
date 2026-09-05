// agent_loop_repeat.go —— the boundary for the path where **the tool loop and compaction chase
// each other** (F-D-14).
//
// What was measured in prod (real third-party DeepWiki): within one turn, the same
// `read_wiki_contents` call was dispatched **8 times**, each returning 374871 bytes, interleaved
// with **8** `context compacted` events, alternating, the whole turn taking 248 seconds. The
// mechanism isn't mysterious: that result **as a message alone doesn't fit inside the 32K
// window**, so compaction inevitably drops it (tailPlainTurns discards tool traces along with
// everything else, see agent_compaction.go), the model finds the evidence gone and fetches it
// again — and fetching again blows out the window again.
//
// **Re-fetching itself isn't the defect**: measured on the eval side, that's the model's normal
// recovery move. The defect is that **nothing ever interrupts the loop**. So what's added here
// isn't "forbid repeated calls", it's a **per-turn ledger**: the second time the same call comes
// in, it no longer hits the other side, it gets back a **bounded summary that survives
// compaction** instead.
//
// **Only large results are handled** (oversizedResultBytes). A repeated call on a small result
// must still dispatch normally: "check the slot again after booking" is a real and correct
// action, and de-duplicating flatly by (name,args) would remove that too — the kind of gate that
// leaves CI green while doing nothing ([[gate-granularity-removes-working-action]]).

package inference

import (
	"context"
	"fmt"
	"sync"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

// oversizedResultBytes —— a result large enough to "blow out the window by itself", **derived**
// from the threshold rather than hand-filled: the compaction line is contextTokenThreshold
// tokens, converted to bytes via eino's own chars/4 estimate, then halved — i.e. "this one result
// eats half the window". Hand-filling a 64000 would silently drift out of sync the day the
// threshold changes ([[computed-class-generates-nothing]]'s family: the name claims to express a
// quantity while actually being a constant).
const oversizedResultBytes = contextTokenThreshold * 4 / 2

// repeatSliceBytes —— how large a section handed out per call is. Also **derived** from the
// window: half of "large enough to blow it out", i.e. a quarter of the window.
//
// The first version hand-filled 6000, against a 120000-byte window — needlessly cautious, at the
// cost of that prod turn never getting to answer "how do I run one". The criterion is "this
// section survives compaction", not "smaller is always safer".
const repeatSliceBytes = oversizedResultBytes / 2

// repeatLedger —— the **large** results dispatched this turn: (tool name, args) → full text +
// how far it's been read.
//
// This is Go-side state, not a message — so compaction can't touch it. That's the whole point:
// the thing compaction drops gets recorded somewhere compaction can't reach.
//
// **Why store the full text plus a cursor, rather than one fixed summary**: measured directly in
// prod. The first version returned **the same opening section** on every repeat, and that turn's
// answer degraded from "seven servers + four ways to run them with commands" to "six servers +
// I can't see the run-it section" — the loop was broken but the answer got worse too. Looking
// back at those eight re-fetches, what the model wanted the second time was **what came after**;
// the eight fetches were really **paging through** the result across compactions. So this makes
// the mechanism match what it actually is: hand over section two the second time, section three
// the third time, until it's done.
type repeatLedger struct {
	seen map[string]*repeatEntry
	mu   sync.Mutex
}

// repeatEntry —— the full text of one large result, plus how many bytes have been handed out.
type repeatEntry struct {
	body   string
	offset int
}

func newRepeatLedger() *repeatLedger {
	return &repeatLedger{seen: map[string]*repeatEntry{}}
}

// repeatSlice —— nextSlice's answer: the section handed out this time, whether more remains,
// and whether this key is known at all. Three facts in one value: revive only allows two return
// values, and squeezing out `known` would make "never seen" and "fully paged through" collapse
// into the same answer — exactly the two this boundary can least afford to conflate.
type repeatSlice struct {
	text  string
	more  bool
	known bool
}

// nextSlice —— has this call been made before? If so, hand out the **next** section, and state
// plainly whether more remains.
func (l *repeatLedger) nextSlice(key string) repeatSlice {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.seen[key]
	if !ok {
		return repeatSlice{}
	}
	if e.offset >= len(e.body) {
		return repeatSlice{known: true} // fully paged through: nothing left, must say so honestly
	}
	end := min(e.offset+repeatSliceBytes, len(e.body))
	text := textcut.BytesMark(e.body[e.offset:end], repeatSliceBytes)
	e.offset = end
	return repeatSlice{text: text, more: e.offset < len(e.body), known: true}
}

// remember —— only records **large** results. The cursor starts at **0**: the model did
// genuinely receive that first full text, but compaction ate it — it now has nothing in hand, so
// paging starts from the beginning, not from "where it left off". Small results aren't recorded:
// they survive compaction on their own, and if the model asks again that's its own business.
func (l *repeatLedger) remember(key, result string) {
	if len(result) < oversizedResultBytes {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seen[key] = &repeatEntry{body: result, offset: 0}
}

// repeatKey —— a call's identity is **name plus arguments**, not name alone.
// De-duplicating by name alone would also swallow "query again with different arguments"
// ([[read-the-key-not-the-name]]).
func repeatKey(name, args string) string {
	return name + "\x00" + args
}

// repeatNote —— what's returned to the model the second time this call comes in.
//
// Worded around "what the model should do next": state plainly that this **was already
// fetched**, hand over **the section fetched this time**, and make clear whether more remains —
// otherwise it just re-issues the same call again (exactly the loop this boundary exists to
// break). Like evidenceDigest, **state honestly that this is partial content**: reading a gap as
// "doesn't exist" is a worse failure (the chain-exhaustion eval caught exactly that once).
func repeatNote(name string, s repeatSlice) string {
	tail := "That is the end of the result — there is no more of it. Answer the visitor from " +
		"what you have, and say plainly which part of their question it doesn't cover."
	if s.more {
		tail = "There is MORE after this. Call the tool with these same arguments again to get " +
			"the next part — each call hands you the next section, it does not re-fetch."
	}
	return fmt.Sprintf(
		"You already called %s with these exact arguments earlier in this turn, and its result is "+
			"far too large to hold in context all at once — so it is being handed to you in "+
			"sections rather than fetched again. Here is the next section:\n\n%s\n\n%s",
		name, s.text, tail,
	)
}

// exhaustedNote —— it's still asking after everything has already been paged through. State
// plainly "there is nothing more", so it doesn't assume one more call will produce something.
func exhaustedNote(name string) string {
	return fmt.Sprintf(
		"You have already been handed every section of %s's result for these arguments this "+
			"turn. There is nothing further to fetch. Answer the visitor now from what you "+
			"have, and say plainly which part of their question the material doesn't cover.", name,
	)
}

// repeatGuardedTool —— a wrapper around one tool: check the ledger first, only really dispatch
// if it hasn't been done before.
type repeatGuardedTool struct {
	inner  tool.InvokableTool
	ledger *repeatLedger
	name   string
}

func (t *repeatGuardedTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return t.inner.Info(ctx) //nolint:wrapcheck // pure passthrough; wrapping obscures the error
}

func (t *repeatGuardedTool) InvokableRun(
	ctx context.Context, args string, opts ...tool.Option,
) (string, error) {
	key := repeatKey(t.name, args)
	if s := t.ledger.nextSlice(key); s.known {
		if s.text == "" {
			return exhaustedNote(t.name), nil
		}
		return repeatNote(t.name, s), nil
	}
	out, err := t.inner.InvokableRun(ctx, args, opts...)
	if err != nil {
		return out, err //nolint:wrapcheck // the tool's own error surfaces as-is, unrewritten
	}
	t.ledger.remember(key, out)
	return out, nil
}

// guardRepeats —— wraps this turn's tool set with the ledger.
//
// **Only wraps invokable tools**: wrapping a streaming tool as non-streaming would silently
// change its behavior, and this boundary has nothing to do with streaming
// ([[move-the-capability-move-its-edges]]: the edges that don't move with a relocation fail
// silently, not loudly).
func guardRepeats(ctx context.Context, tools []tool.BaseTool) []tool.BaseTool {
	ledger := newRepeatLedger()
	out := make([]tool.BaseTool, 0, len(tools))
	for _, t := range tools {
		guarded, ok := guardOne(ctx, t, ledger)
		if !ok {
			out = append(out, t)
			continue
		}
		out = append(out, guarded)
	}
	return out
}

// guardOne —— returns the wrapper if it could wrap it, false if not (caller passes it through
// unchanged). Doesn't return `tool.BaseTool`: that would force every "pass through" branch to
// re-construct an interface value, and readers couldn't tell "wrapped" from "passed through
// as-is" apart.
func guardOne(
	ctx context.Context, t tool.BaseTool, ledger *repeatLedger,
) (*repeatGuardedTool, bool) {
	inv, ok := t.(tool.InvokableTool)
	if !ok {
		return nil, false
	}
	if _, streaming := t.(tool.StreamableTool); streaming {
		return nil, false
	}
	info, err := t.Info(ctx)
	if err != nil || info == nil {
		return nil, false
	}
	return &repeatGuardedTool{inner: inv, ledger: ledger, name: info.Name}, true
}
