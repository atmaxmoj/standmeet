// cue.go —— assistant.cue: the card for one line, streamed into the feed under one id as it is
// written (the page and every reader of assistant.read see it grow), returned whole at the end.

package cues

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
)

const (
	// pushEvery —— how often the growing card is written to the feed.
	pushEvery   = 300 * time.Millisecond
	feedIDBytes = 8
)

// Card —— a finished cue. Mode / Used / From are the citation metadata a verifier reads to check
// the two-state invariant without parsing the card (cue acceptance follow-up #2, proposal C).
type Card struct {
	Text   string
	FeedID string
	Model  string
	Mode   string   // "generic" (general judgment, marked, no From) | "grounded" (non-empty From)
	Used   []string // the note paths the model declared on its USED line (raw, before filtering)
	From   []string // the paths the server actually stamped as the From citation
	Prompt Prompt
}

// Cue —— the card for q. feedID names the card's feed event ("" = a new id); a call's history
// and job lock carry over when q.CallID is set.
func (a *Assistant) Cue(
	ctx context.Context, log *slog.Logger, ownerID, feedID string, q *Ask,
) (Card, error) {
	p, err := a.begin(ctx, ownerID, q)
	if err != nil {
		return Card{}, err
	}
	if feedID == "" {
		feedID = newFeedID()
	}
	req := ModelRequest{System: p.System, Messages: p.messages}
	model, text, err := a.ports.Model(ctx, ownerID, p.role.ProviderID, req,
		a.streamer(ctx, log, ownerID, feedID))
	if err != nil {
		return Card{}, fmt.Errorf("%w: %w", errModelCall, err)
	}
	fin := finalize(text, p.Sources, p.NamedProjects, p.posting())
	if ferr := a.finish(ctx, ownerID, feedID, q.CallID, fin.card); ferr != nil {
		return Card{}, ferr
	}
	return Card{
		Text: fin.card, FeedID: feedID, Model: model, Prompt: p,
		Mode: fin.mode, Used: declaredUsed(text), From: fin.from,
	}, nil
}

var (
	// usedLineRE / fromLineRE —— the card's machine lines. The model declares which notes it used
	// on a USED line; it must not write a From line, and any it writes is stripped and replaced.
	usedLineRE = regexp.MustCompile(`(?mi)^[ \t]*used:[ \t]*(.*?)[ \t]*$`)
	fromLineRE = regexp.MustCompile(`(?mi)^[ \t]*_?from:[ \t]*(.*?)_?[ \t]*$`)
)

// genericMarker —— the substring a generic card carries (genericMarkerLine is the full line). Its
// presence means the answer is general judgment, so the card carries no From.
const (
	genericMarker     = "not from your notes"
	genericMarkerLine = "_General — not from your notes._"
	// postingCitation —— the From for a process answer drawn from the role's posting (H2). The
	// posting is a provided source, so the card is grounded, not general judgment.
	postingCitation = "the role's posting"
)

// postingRE —— a USED declaration that the answer came from the role's posting/packet (H2).
var postingRE = regexp.MustCompile(`(?i)\b(posting|packet)\b`)

// finished —— a finalised card and the citation metadata a verifier reads (follow-up #2 C).
type finished struct {
	card string
	mode string // "generic" | "grounded"
	from []string
}

// finalize —— the citation is the server's, never the model's (cue-generic-fabrication-fix F-2).
// Strip any From line the model wrote, read its "USED: <paths>" declaration, keep only paths really
// in the context (sources), and stamp one real From from those. Backstops (F-3 / follow-up #1):
//   - a card the model marked generic carries NO From — generic judgment never cites the owner;
//   - a project note grounds a card only when the question named it (groundedCitations).
//
// It enforces the TWO-STATE invariant (acceptance follow-up #2): every card is EITHER grounded —
// a non-empty stamped From, no general marker — OR generic — the general marker, no From. The
// forbidden third state (neither marker nor From, from a model that omitted USED) is resolved to
// generic: a card that declared no usable source is marked general, never shown as the owner's
// uncited grounded experience. So the model omitting its USED line can only ever UNDER-claim.
// posting is the citation for the role's posting when the packet carried posted facts, else "".
func finalize(text string, sources, namedProjects []string, posting string) finished {
	body := stripControl(text)
	if strings.Contains(strings.ToLower(body), genericMarker) {
		return finished{card: body, mode: "generic"}
	}
	cites := groundedCitations(usedPaths(text, sources), namedProjects)
	if posting != "" && usedPosting(text) {
		cites = append(cites, posting) // a process answer from the posting is grounded (H2).
	}
	if len(cites) == 0 {
		return finished{card: genericMarkerLine + "\n\n" + body, mode: "generic"}
	}
	card := body + "\n\n_From: " + strings.Join(cites, ", ") + "_"
	return finished{card: card, mode: "grounded", from: cites}
}

// posting / Prompt.posting —— the citation for the role's posting when the packet carried posted
// facts, else "". Defined here beside the posting-citation logic (built lives in deck.go).
func (b *built) posting() string {
	if b.hasPosting {
		return postingCitation
	}
	return ""
}

// usedPosting —— the model declared on its USED line that it answered from the role's posting.
func usedPosting(text string) bool {
	m := usedLineRE.FindStringSubmatch(text)
	return len(m) > 1 && postingRE.MatchString(m[1])
}

// declaredUsed —— the note paths the model named on its USED line, raw (parens trimmed, "none"
// dropped), before any filtering. For the verifier to spot a card whose content is grounded but
// whose declaration is empty (follow-up #2 proposal B/C).
func declaredUsed(text string) []string {
	out := []string{}
	m := usedLineRE.FindStringSubmatch(text)
	if m == nil {
		return out
	}
	for raw := range strings.SplitSeq(m[1], ",") {
		if p := strings.Trim(raw, " \t()"); p != "" && !strings.EqualFold(p, "none") {
			out = append(out, p)
		}
	}
	return out
}

// groundedCitations —— the used paths that may show as a grounded From: every non-project note, and
// a project note (software/project/<slug>) only when the question named that project (G2).
// An unnamed project's note is adjacent — it shares a word, it is not the answer to THIS question.
func groundedCitations(used, namedProjects []string) []string {
	named := make(map[string]bool, len(namedProjects))
	for _, s := range namedProjects {
		named[s] = true
	}
	kept := []string{}
	for _, p := range used {
		if strings.HasPrefix(p, "software/project/") && !named[projectSlug(p)] {
			continue
		}
		kept = append(kept, p)
	}
	return kept
}

// stripControl —— the card without its machine lines (any model From line, the USED declaration):
// what a reader sees. Used mid-stream and before stamping.
func stripControl(text string) string {
	t := fromLineRE.ReplaceAllString(text, "")
	t = usedLineRE.ReplaceAllString(t, "")
	return strings.TrimSpace(t)
}

// usedPaths —— the note paths the model declared under USED, kept only when they were really in
// the context. Intersecting with sources is what makes a citation unforgeable: a path the model
// invents is not in sources and is dropped. Each real path is kept once.
func usedPaths(text string, sources []string) []string {
	out := []string{}
	m := usedLineRE.FindStringSubmatch(text)
	if m == nil {
		return out
	}
	fed := make(map[string]bool, len(sources))
	for _, s := range sources {
		fed[s] = true
	}
	for raw := range strings.SplitSeq(m[1], ",") {
		// tolerate a path the model copied with its surrounding "(…)" from the context header.
		if p := strings.Trim(raw, " \t()"); fed[p] {
			fed[p] = false // keep each real path once
			out = append(out, p)
		}
	}
	return out
}

// fromLine —— the citation content of a finished card's From line, or "" when it carries none.
func fromLine(card string) string {
	if m := fromLineRE.FindStringSubmatch(card); m != nil {
		return m[1]
	}
	return ""
}

// begin —— the prompt, with the call locked onto a job the line named, and the messages: the
// line on its own, or the call so far with the line added.
func (a *Assistant) begin(ctx context.Context, ownerID string, q *Ask) (Prompt, error) {
	p, err := a.Context(ctx, ownerID, q)
	if err != nil {
		return Prompt{}, err
	}
	if p.messages, err = a.callMessages(ctx, ownerID, q.CallID, &p); err != nil {
		return Prompt{}, err
	}
	p.messages[len(p.messages)-1].Content = asHeard(&p.Heard)
	return p, nil
}

// callMessages —— the line on its own, or the call so far with the line added (and the call
// locked onto a job the line named).
func (a *Assistant) callMessages(
	ctx context.Context, ownerID, callID string, p *Prompt,
) ([]Message, error) {
	line := Message{Role: "user", Content: strings.TrimSpace(p.Heard.Question)}
	if callID == "" {
		return []Message{line}, nil
	}
	if p.noticed != nil {
		if err := a.Feed.lockJob(ctx, ownerID, callID, p.noticed); err != nil {
			return nil, err
		}
	}
	return a.Feed.addLine(ctx, ownerID, callID, line)
}

// asHeard —— the line for the card model: as meant, with what speech recognition heard beside it
// when the rewrite changed it, so the model can tell a doubtful fix.
func asHeard(h *Heard) string {
	meant := strings.TrimSpace(h.Question)
	if meant == strings.TrimSpace(h.Raw) {
		return meant
	}
	return meant + "\n\n(speech recognition heard: \"" + strings.TrimSpace(h.Raw) + "\")"
}

// streamer —— writes the growing card to the feed at most every pushEvery; a failed step is
// logged, the final push still counts.
func (a *Assistant) streamer(
	ctx context.Context, log *slog.Logger, ownerID, id string,
) func(string) {
	last := time.Time{}
	return func(text string) {
		if time.Since(last) < pushEvery {
			return
		}
		last = time.Now()
		if err := a.Feed.Push(ctx, ownerID, feedCard(id, stripControl(text))); err != nil {
			log.Warn("cue stream push", "err", err)
		}
	}
}

// feedCard —— the card as the feed shows it: a card longer than the feed holds is cut there,
// never refused (the caller still gets the whole card).
func feedCard(id, text string) *Event {
	if len(text) > maxText {
		text = strings.ToValidUTF8(text[:maxText], "")
	}
	return &Event{ID: id, Kind: KindCue, Text: text}
}

// finish —— the whole card into the feed, and onto the call's history.
func (a *Assistant) finish(ctx context.Context, ownerID, feedID, callID, text string) error {
	card := strings.TrimSpace(text)
	if card == "" {
		return fmt.Errorf("%w: the model returned no text", errModelCall)
	}
	if err := a.Feed.Push(ctx, ownerID, feedCard(feedID, text)); err != nil {
		return err
	}
	if callID == "" {
		return nil
	}
	return a.Feed.addCard(ctx, ownerID, callID, card)
}

func newFeedID() string {
	b := make([]byte, feedIDBytes)
	_, _ = rand.Read(b)
	return "srv-" + hex.EncodeToString(b)
}
