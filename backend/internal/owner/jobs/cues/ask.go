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
	// Rewrite —— turn the line as heard into the line as meant first (rewrite.go).
	Rewrite bool
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
	Heard    Heard
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
	heard, err := a.hear(ctx, ownerID, q, &rd, &screen)
	if err != nil {
		return Prompt{}, err
	}
	return compose(q, round, &rd, &screen, heard), nil
}

// hear —— the line as meant: rewritten when q.Rewrite (stutters, fillers, a cut sentence, a
// mis-heard name), else as heard.
func (a *Assistant) hear(
	ctx context.Context, ownerID string, q *Ask, rd *roleDeck, screen *screenPick,
) (Heard, error) {
	if !q.Rewrite {
		return Heard{Raw: q.Question, Question: q.Question}, nil
	}
	earlier := []string{}
	if q.CallID != "" {
		var err error
		if earlier, err = a.Feed.callLines(ctx, ownerID, q.CallID, rewriteContext); err != nil {
			return Heard{}, err
		}
	}
	return a.rewrite(ctx, ownerID, &toRewrite{
		provider: rd.role.ProviderID, line: q.Question,
		names: rd.deck.ownNames(screen.companies), earlier: earlier,
	}), nil
}

// compose —— the system prompt for the line as meant.
func compose(q *Ask, round *Round, rd *roleDeck, screen *screenPick, heard Heard) Prompt {
	b := rd.deck.build(heard.Question, round, screen.text)
	extra := ""
	if t := jsTrim(q.UserContext); t != "" {
		extra = "\n\n## Also from the user\n" + t
	}
	return Prompt{
		System:  systemPrompt(b.context+extra, round.closingRules()),
		Context: b.context, Sources: b.sources, Named: b.named, Matrix: b.matrix,
		role: rd.role, noticed: screen.noticed, Heard: heard,
	}
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
	noticed   *Job
	text      string
	companies []string // every applied job's company: names the rewrite may restore
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
	return pickScreen(&screen, &job, q.Question), nil
}

// pickScreen —— the locked job, else the applied job this line names (noticed), else none.
func pickScreen(screen *Screen, locked *Job, line string) screenPick {
	pick := screenPick{companies: screen.companies()}
	switch i := screen.notice(line); {
	case locked.Company != "":
		pick.text = screen.context(locked)
	case i < 0:
		pick.text = screen.context(nil)
	default:
		pick.text, pick.noticed = screen.context(&screen.Jobs[i]), &screen.Jobs[i]
	}
	return pick
}

// lockedJob —— the job the call is locked onto; none for a line on its own.
func (a *Assistant) lockedJob(ctx context.Context, ownerID, callID string) (Job, error) {
	if callID == "" {
		return Job{}, nil
	}
	return a.Feed.lockedJob(ctx, ownerID, callID)
}
