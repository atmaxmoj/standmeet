// ask.go —— one question to the assistant: the session's start (Prepare) and the system prompt
// a line gets (Context), which assistant.cue then sends.

package cues

import (
	"context"
	"fmt"
	"strings"
)

// Ask —— one question to the assistant.
type Ask struct {
	RoleRef     string // role id or name; "" = the whole wiki
	Round       string // a Rounds id; "" = General
	Question    string
	CallID      string // the call this line belongs to; "" = a line on its own
	UserContext string // the owner's extra words for this session
}

// Prepared —— what a session starts with.
type Prepared struct {
	Role  *Role
	Hint  string
	Notes int
}

// Prepare —— loads the role's deck: its note count and the names for Whisper's prompt.
func (a *Assistant) Prepare(ctx context.Context, ownerID, ref string) (Prepared, error) {
	rd, err := a.deckFor(ctx, ownerID, ref)
	if err != nil {
		return Prepared{}, err
	}
	screen, err := a.ports.Screen(ctx, ownerID)
	if err != nil {
		return Prepared{}, err
	}
	companies := make([]string, 0, len(screen.Jobs))
	for _, j := range screen.Jobs {
		companies = append(companies, j.Company)
	}
	p := Prepared{Hint: rd.deck.Hint(companies), Notes: rd.deck.Count()}
	if ref != "" {
		p.Role = &rd.role
	}
	return p, nil
}

// Prompt —— a question's system prompt and what went into it.
type Prompt struct {
	// noticed —— the applied job this line named, which the call locks onto (nil = none new).
	noticed *Job
	// messages —— what assistant.cue sends after the system prompt.
	messages []Message
	System   string
	Context  string
	Sources  []string
	Named    []string
	role     Role
	Matrix   bool
}

// Context —— the prompt assistant.cue would send for this question; nothing is written.
func (a *Assistant) Context(ctx context.Context, ownerID string, q *Ask) (Prompt, error) {
	round, err := checkAsk(q)
	if err != nil {
		return Prompt{}, err
	}
	rd, err := a.deckWithNotes(ctx, ownerID, q.RoleRef)
	if err != nil {
		return Prompt{}, err
	}
	screen, err := a.callScreen(ctx, ownerID, q)
	if err != nil {
		return Prompt{}, err
	}
	b := rd.deck.build(q.Question, round, screen.text)
	extra := ""
	if t := jsTrim(q.UserContext); t != "" {
		extra = "\n\n## Also from the user\n" + t
	}
	return Prompt{
		System:  systemPrompt(b.context+extra, round.closingRules()),
		Context: b.context, Sources: b.sources, Named: b.named, Matrix: b.matrix,
		role: rd.role, noticed: screen.noticed,
	}, nil
}

// deckWithNotes —— the role's deck; a scope that holds nothing is an error, not an empty card.
func (a *Assistant) deckWithNotes(ctx context.Context, ownerID, ref string) (roleDeck, error) {
	rd, err := a.deckFor(ctx, ownerID, ref)
	if err == nil && rd.deck.Count() == 0 {
		err = ErrNoNotes
	}
	return rd, err
}

func checkAsk(q *Ask) (*Round, error) {
	if strings.TrimSpace(q.Question) == "" {
		return nil, ErrNoQuery
	}
	round := RoundByID(q.Round)
	if round == nil {
		return nil, fmt.Errorf("%w: %q", ErrBadRound, q.Round)
	}
	return round, nil
}

type screenPick struct {
	noticed *Job
	text    string
}

// callScreen —— the phone-screen block: the script, and the job the call is locked onto, or the
// applied job this line names (noticed: assistant.cue then locks the call onto it).
func (a *Assistant) callScreen(ctx context.Context, ownerID string, q *Ask) (screenPick, error) {
	screen, err := a.ports.Screen(ctx, ownerID)
	if err != nil {
		return screenPick{}, err
	}
	job, err := a.lockedJob(ctx, ownerID, q.CallID)
	if err != nil {
		return screenPick{}, err
	}
	if job.Company != "" {
		return screenPick{text: screen.context(&job)}, nil
	}
	i := screen.notice(q.Question)
	if i < 0 {
		return screenPick{text: screen.context(nil)}, nil
	}
	return screenPick{text: screen.context(&screen.Jobs[i]), noticed: &screen.Jobs[i]}, nil
}

// lockedJob —— the job the call is locked onto; none for a line on its own.
func (a *Assistant) lockedJob(ctx context.Context, ownerID, callID string) (Job, error) {
	if callID == "" {
		return Job{}, nil
	}
	return a.Feed.lockedJob(ctx, ownerID, callID)
}
