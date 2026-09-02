// agent_turn_persist.go —— #28: the backend owns this turn. The "DB sink" at the end of the
// agent event stream.
//
// The design is stream → (tee) → {display sink, accumulation}. sseSink is the display tap
// (sinks to the browser; fine if the connection drops); accumSink wraps it, accumulating the
// same stream into one plain TurnResult, which the loop hands to the injected PersistFunc at
// wrap-up to sink into the conversation table — that's the actual durable landing spot.
//
// DDD: inference only understands "the stream", it never touches the DB. Persistence fires
// through an injected port (PersistFunc); inference doesn't know where it lands (the
// routes/usecases layer supplies the closure, wired through RecordDialog). The accumulated
// shape of citations / tool_calls matches the old frontend approach byte-for-byte (scrape the
// entry id from corpus_read results; tool_calls = [{name, ok, result}]) — only the sink itself
// moved from "the frontend acting as sink" to the end of the stream.

package inference

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
)

// TurnResult —— the persistable output an entire turn accumulates on the backend. Question is
// filled in by the caller from in.Req.UserMessage (accumSink doesn't know the question); the
// rest is accumulated from the event stream.
type TurnResult struct {
	Question             string
	Answer               string
	ToolCalls            json.RawMessage
	CitedWikiIDs         []string
	CitedWritingIDs      []string
	CitedOutputIDs       []string
	CitedSubjectivityIDs []string
}

// PersistFunc —— the persistence port. RunAgentTurn calls it once when the loop wraps up (and
// only when the AI actually produced content). ctx has been detached (stays alive even if the
// client disconnected), so it sinks even when no one's listening to the stream anymore.
type PersistFunc func(ctx context.Context, res *TurnResult) error

// TurnUsage —— token usage accumulated across one turn's react-loop.
//
// Cached is the portion of the prompt that hit cache — **this is the only granularity upstream
// is willing to give us**: eino's claude adapter has already summed input + cache_read +
// cache_creation into one number before it reaches us (claude.go:1046). We store what we can
// actually get, without pretending to have full resolution.
type TurnUsage struct {
	Model  string
	In     int
	Out    int
	Cached int
}

// RecordUsageFunc —— the #106 billing port. DriveAgentLoop hands out this turn's usage when it
// wraps up; the route handler injects a closure wired to the inference_usage table (it's the
// only one that knows which tank this trip drew from, and whether it counts against the bill).
//
// The argument is a struct, not four separate parameters: the previous version took (model, in,
// out) as three parameters, which left "how much hit cache" with nowhere to go — the signature
// itself pinned the resolution.
type RecordUsageFunc func(ctx context.Context, u *TurnUsage)

// MarkWaypointsFunc —— the ghost-steering ledger port. At turn wrap-up, hands out this turn's
// citations (cited note ids) + this turn's successful tool-name hits; the route handler's
// injected closure resolves the URI + marks the waypoint visited + saves it to the session.
// inference never touches DB/redis. nil = don't mark (not code / no waypoints).
type MarkWaypointsFunc func(ctx context.Context, citedNoteIDs, successfulTools []string)

// persistedToolCall —— the persisted shape of one tool call. result passes through unchanged
// (the tool's full output JSON); ok is taken from the top-level envelope. Aligned with the
// frontend's ToolCallView / dialogRequest.tool_calls shape, so the conversation read model +
// admin transcript render it exactly as-is.
// Field order follows govet fieldalignment: the ones with pointer-like layouts (string / slice)
// grouped first, bool last. JSON parses by key, so order doesn't matter there.
type persistedToolCall struct {
	Name   string          `json:"name"`
	Result json.RawMessage `json:"result"`
	OK     bool            `json:"ok"`
}

// accumSink —— a tee: forwards to the display sink (inner), while also accumulating a
// TurnResult at the end of the stream. Pure accumulation, never touches the DB. tool_calls are
// collected in their persisted shape; citations are scraped from corpus_read results as entry
// ids (de-duplicated by id).
//
// answer only accepts PRODUCT (F-A-4 P1): text streamed in a round that ends with tool calls is
// the model narrating its plan — process, not the answer; it must not enter the durable
// transcript. Mechanically: text accumulates in `segment`; a ToolStarted proves the segment
// was process → discard; only tool-less tails (incl. the forced-final synthesis) survive
// into `answer`.
type accumSink struct {
	inner AgentSink
	// onDone —— the stream wrap-up hook, runs (persists) **before** the `done` frame is
	// forwarded to the browser. This way the `done` frame really means "this turn is
	// committed": if the browser reloads right after receiving done, a GET conversation is
	// guaranteed to see this turn — no persist-vs-reload race. RunAgentTurn injects the
	// persistence closure here.
	onDone     func()
	tools      []persistedToolCall
	wikiIDs    []string
	writingIDs []string
	outIDs     []string
	subjIDs    []string
	seenCite   map[string]bool
	answer     strings.Builder
	segment    strings.Builder
}

var _ AgentSink = (*accumSink)(nil)

func newAccumSink(inner AgentSink) *accumSink {
	return &accumSink{inner: inner, seenCite: map[string]bool{}}
}

func (a *accumSink) Text(delta string) {
	// strings.Builder.WriteString never returns an error; discarded explicitly (revive
	// unhandled-error).
	_, _ = a.segment.WriteString(delta)
	a.inner.Text(delta)
}

// ToolStarted —— proof the pending segment was planning narration (the model kept working
// after saying it) → process, dropped from the durable answer.
func (a *accumSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	a.segment.Reset()
	a.inner.ToolStarted(id, name, progressLabel, args)
}

func (a *accumSink) ToolCompleted(name, result string) {
	a.accumulateTool(name, result)
	a.inner.ToolCompleted(name, result)
}

func (a *accumSink) Epilogue(f *EpilogueFrame) { a.inner.Epilogue(f) }
func (a *accumSink) Retrying(attempt int)      { a.inner.Retrying(attempt) }
func (a *accumSink) Error(err error)           { a.inner.Error(err) }

// Done —— persists (onDone) first, then forwards the `done` frame. The order is deliberate:
// the browser treats done as the "turn committed" signal, so persistence must complete before
// it. At wrap-up, the last (tool-less) segment is committed into answer — that's the actual
// product.
func (a *accumSink) Done(stop string) {
	_, _ = a.answer.WriteString(a.segment.String())
	a.segment.Reset()
	if a.onDone != nil {
		a.onDone()
	}
	a.inner.Done(stop)
}

// successfulToolNames —— names of the tools that ran successfully this turn. inference doesn't
// know which one counts as a "terminal" tool (that's an externalized capability's concept, like
// a booking-confirmed action); it only reports the names, leaving the route layer that injects
// the ledger port (which does know the specific capabilities) to judge a terminal hit.
func (a *accumSink) successfulToolNames() []string {
	out := make([]string, 0, len(a.tools))
	for i := range a.tools {
		if a.tools[i].OK {
			out = append(out, a.tools[i].Name)
		}
	}
	return out
}

// accumulateTool —— a tool has completed: collects {name, ok, result} in its persisted shape,
// and scrapes a citation entry id out of corpus_read results.
func (a *accumSink) accumulateTool(name, result string) {
	ok := envelopeOK(result)
	a.tools = append(a.tools, persistedToolCall{
		Name: name, OK: ok, Result: json.RawMessage(result),
	})
	if ok {
		a.collectCitation(name, result)
	}
}

// envelopeOK —— if the result's top level is an envelope carrying `ok: bool`, use that value;
// otherwise treat it as successful (a bare array / flat object / scalar). Matches the
// frontend's safeParseToolResult.
func envelopeOK(result string) bool {
	var probe map[string]json.RawMessage
	if json.Unmarshal([]byte(result), &probe) != nil {
		return true
	}
	raw, has := probe["ok"]
	if !has {
		return true
	}
	var b bool
	if json.Unmarshal(raw, &b) != nil {
		return true
	}
	return b
}

// collectCitation —— scrapes an entry id from a successful corpus_read result (a flat object
// {id, genre, ...}), **explicitly bucketed by genre**, de-duplicated by id (reading the same
// entry multiple times cites it only once). The caller guarantees this is only called when ok.
//
// It's correct that citation only hangs off corpus_read: the read is the signal that "this one
// was actually used" (a search only finds candidates). corpus_read isn't a kind of retrieval,
// it IS the act of "reading" — the same way a paper only cites the references you actually read
// and used, not every entry that surfaced in a literature search.
// Explicit routing (not a catch-all): output→outIDs, wiki→wikiIDs, writing→writingIDs,
// subjectivity→subjIDs. Any other genre (raw) isn't accumulated. writing is a public/published
// blog entry, always goes into the footer (no show_as_source gate); whether subjectivity is
// actually shown is decided by the dialog layer's show_as_source gate (private by default).
func (a *accumSink) collectCitation(name, result string) {
	if name != "corpus_read" {
		return
	}
	c := parseCitedEntry(result)
	if c.ID == "" || a.seenCite[c.ID] || suppressedFromCitation(&c) {
		return
	}
	a.seenCite[c.ID] = true
	a.routeCitation(c.Genre, c.ID)
}

// suppressedFromCitation —— the readCollector gate: a wiki/output entry marked
// show_as_source=false (meta/persona-type entries) can still have its body read by the AI, but
// doesn't go into the cited footer. subjectivity's show_as_source gate lives in the dialog
// layer; not touched here.
func suppressedFromCitation(c *citedEntry) bool {
	return (c.Genre == "wiki" || c.Genre == "output") && !c.ShowAsSource
}

// routeCitation —— routes an entry id into its matching slice by genre (a bucket table). A
// genre not in the table (raw, etc.) doesn't go into the footer and is discarded. writing is a
// public blog entry, and does go into the footer.
func (a *accumSink) routeCitation(genre, id string) {
	bucket := map[string]*[]string{
		"output":       &a.outIDs,
		"wiki":         &a.wikiIDs,
		"writing":      &a.writingIDs,
		"subjectivity": &a.subjIDs,
	}[genre]
	if bucket == nil {
		return // raw and similar genres don't go into the citation footer; discarded.
	}
	*bucket = append(*bucket, id)
}

// citedEntry —— the fields pulled from a corpus_read flat object for citation purposes. A
// wiki/output entry with show_as_source=false can still have its body read, but doesn't go
// into cited (the readCollector gate).
type citedEntry struct {
	ID           string `json:"id"`
	Genre        string `json:"genre"`
	ShowAsSource bool   `json:"show_as_source"`
}

// parseCitedEntry —— parses the citation entry out of a corpus_read result; parse failure →
// zero value.
func parseCitedEntry(result string) citedEntry {
	var c citedEntry
	if json.Unmarshal([]byte(result), &c) != nil {
		return citedEntry{}
	}
	return c
}

func (a *accumSink) answered() bool {
	return a.answer.Len() > 0
}

// result —— produces the TurnResult once a turn has finished accumulating. tool_calls gets
// `[]` even when empty (the read model's rawOrEmptyArray expects non-nil).
func (a *accumSink) result(question string) *TurnResult {
	return &TurnResult{
		Question:             question,
		Answer:               a.answer.String(),
		ToolCalls:            a.marshalTools(),
		CitedWikiIDs:         a.wikiIDs,
		CitedWritingIDs:      a.writingIDs,
		CitedOutputIDs:       a.outIDs,
		CitedSubjectivityIDs: a.subjIDs,
	}
}

func (a *accumSink) marshalTools() json.RawMessage {
	if len(a.tools) == 0 {
		return json.RawMessage("[]")
	}
	b, err := json.Marshal(a.tools)
	if err != nil {
		return json.RawMessage("[]")
	}
	return b
}

// persistTurn —— at the end of the loop, sinks this accumulated turn into the DB (the injected
// PersistFunc). Only persists when the AI actually produced content (a locked-in model: a
// dialog persists iff it produced an answer); skipped when the port isn't injected (a
// stateless smoke call with no conversation) or there's no answer.
func persistTurn(ctx context.Context, log *slog.Logger, in *AgentTurnInput, acc *accumSink) {
	if in.Persist == nil || !producedContentForPersist(acc, in.ReturnDirectly) {
		return
	}
	if err := in.Persist(ctx, acc.result(in.Req.UserMessage)); err != nil {
		log.Error("agent turn persist", logErrKey, err)
	}
}

// producedContentForPersist —— F-A-19: persist a turn iff it produced durable content: EITHER
// a synthesized answer, OR a return_directly tool ran (a report / a terminal action / a prompt)
// whose RESULT is the product (report card / confirmation) even with no answer text. Must NOT widen
// to "any tool ran": a narration-only turn whose tools were GROUNDING (corpus_search) with
// no synthesis must stay unpersisted (F-A-4 — don't persist planning narration as a dialog).
func producedContentForPersist(acc *accumSink, returnDirectly map[string]bool) bool {
	return acc.answered() || acc.ranReturnDirectly(returnDirectly)
}

// ranReturnDirectly —— did this turn run any return_directly tool? Such a tool ends the turn
// and its result is the product worth persisting.
func (a *accumSink) ranReturnDirectly(returnDirectly map[string]bool) bool {
	for i := range a.tools {
		if returnDirectly[a.tools[i].Name] {
			return true
		}
	}
	return false
}

// markWaypointsTurn —— the ghost-steering ledger: hands this turn's citations (cited note ids)
// + terminal hits to the injected port. Skipped when the port is nil (not code / no waypoints).
func markWaypointsTurn(ctx context.Context, in *AgentTurnInput, acc *accumSink) {
	if in.MarkWaypoints == nil {
		return
	}
	cited := make([]string, 0, len(acc.wikiIDs)+len(acc.outIDs))
	cited = append(cited, acc.wikiIDs...)
	cited = append(cited, acc.outIDs...)
	in.MarkWaypoints(ctx, cited, acc.successfulToolNames())
}
