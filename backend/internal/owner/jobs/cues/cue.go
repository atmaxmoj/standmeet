// cue.go —— assistant.cue: the card for one line, streamed into the feed under one id as it is
// written (the page and every reader of assistant.read see it grow), returned whole at the end.

package cues

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"slices"
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
	Text      string
	FeedID    string
	Model     string
	Mode      string   // "generic" (general judgment, marked, no From) | "grounded" (a From)
	Used      []string // the note paths the model declared on its USED line (raw, before filtering)
	From      []string // the paths the server actually stamped as the From citation
	Downgrade string   // why a generic card is generic, or a gap-admission tripwire reason (R4)
	// Terms —— the optional glossary (cue 术语表 spec): the library terms the card body mentions, in
	// first-appearance order, each with a one-line definition. Empty = app shows no Terms block.
	// Purely additive — derived from the finished text, it changes none of the fields above.
	Terms  []TermEntry
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
	named := a.effectiveNamed(ctx, log, ownerID, q, &p)
	req := ModelRequest{System: p.System, Messages: p.messages}
	model, text, err := a.ports.Model(ctx, ownerID, p.role.ProviderID, req,
		a.streamer(ctx, log, ownerID, feedID))
	if err != nil {
		return Card{}, fmt.Errorf("%w: %w", errModelCall, err)
	}
	fin := finalize(text, &cueCtx{
		sources: p.Sources, namedProjects: named, posting: p.posting(),
		question: p.Heard.Question,
	})
	if ferr := a.finish(ctx, ownerID, feedID, q.CallID, fin.card); ferr != nil {
		return Card{}, ferr
	}
	return Card{
		Text: fin.card, FeedID: feedID, Model: model, Prompt: p,
		Mode: fin.mode, Used: declaredUsed(text), From: fin.from, Downgrade: fin.downgrade,
		Terms: cardTerms(fin.card),
	}, nil
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
	line := Message{
		Role: "user", Content: strings.TrimSpace(p.Heard.Question),
		TurnID: newTurnID(), Named: p.NamedProjects,
	}
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

// newTurnID —— a stable id for a user turn, so the classifier can name the anchor it followed.
func newTurnID() string {
	b := make([]byte, feedIDBytes)
	_, _ = rand.Read(b)
	return "t-" + hex.EncodeToString(b)
}

// effectiveNamed —— the named-project set finalize grounds against: the line's own named projects,
// widened with the ones it inherits from its anchor chain when the classifier calls it a follow-up
// (follow-up 链 §2). No call, no chain, or a chain read error → just the line's own set (fail
// closed). The classifier runs a model only for ambiguous cases (explicit / bare references take
// its rule fast-path). begin already appended this line, so the last chain turn is dropped — the
// classifier sees only the earlier turns this line may follow.
func (a *Assistant) effectiveNamed(
	ctx context.Context, log *slog.Logger, ownerID string, q *Ask, p *Prompt,
) []string {
	if q.CallID == "" {
		return p.NamedProjects
	}
	chain, err := a.Feed.callChain(ctx, ownerID, q.CallID)
	if err != nil {
		log.Warn("cue classify: read call chain", "err", err)
		return p.NamedProjects
	}
	prior := priorTurns(chain)
	if len(prior) == 0 {
		return p.NamedProjects
	}
	cl := classify(prior, p.Heard.Question, a.classifyModel(ctx, ownerID, p.role.ProviderID))
	log.Info("cue classify",
		"follow_up", cl.FollowUp, "anchor", cl.AnchorTurnID,
		"inherited", cl.InheritedProjects, "reason", cl.Reason)
	return unionProjects(p.NamedProjects, cl.InheritedProjects)
}

// priorTurns —— the chain without its last user turn (the line begin just appended), so the
// classifier never sees the current question as one of its own antecedents.
func priorTurns(chain []ChainTurn) []ChainTurn {
	if len(chain) == 0 {
		return chain
	}
	return chain[:len(chain)-1]
}

// classifyModel —— the small-model adjudicator for the classifier's ambiguous path. It fails closed
// (returns not-a-follow-up) on any model error, so a flaky classifier only ever under-grounds.
func (a *Assistant) classifyModel(ctx context.Context, ownerID, providerID string) ClassifierModel {
	return func(prior []ChainTurn, question string) (bool, string) {
		req := ModelRequest{System: classifierSystem, Messages: classifierMessages(prior, question)}
		_, text, err := a.ports.Model(ctx, ownerID, providerID, req, func(string) {})
		if err != nil {
			return false, "classifier model error"
		}
		return parseFollowUp(text)
	}
}

// unionProjects —— own ∪ inherited, first-appearance order, deduped.
func unionProjects(own, inherited []string) []string {
	seen := make(map[string]bool, len(own)+len(inherited))
	out := make([]string, 0, len(own)+len(inherited))
	for _, s := range slices.Concat(own, inherited) {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
