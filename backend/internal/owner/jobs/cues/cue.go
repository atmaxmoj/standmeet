// cue.go —— assistant.cue: the card for one line, streamed into the feed under one id as it is
// written (the page and every reader of assistant.read see it grow), returned whole at the end.

package cues

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

const (
	// pushEvery —— how often the growing card is written to the feed.
	pushEvery   = 300 * time.Millisecond
	feedIDBytes = 8
)

// Card —— a finished cue.
type Card struct {
	Text   string
	FeedID string
	Model  string
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
	if ferr := a.finish(ctx, ownerID, feedID, q.CallID, text); ferr != nil {
		return Card{}, ferr
	}
	return Card{Text: text, FeedID: feedID, Model: model, Prompt: p}, nil
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
		if err := a.Feed.Push(ctx, ownerID, feedCard(id, text)); err != nil {
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
