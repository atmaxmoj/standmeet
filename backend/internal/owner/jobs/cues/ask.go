// ask.go —— one question to the assistant: the session's start (Prepare) and the system prompt
// a line gets (Context), which assistant.cue then sends.

package cues

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Ask —— one question to the assistant.
type Ask struct {
	RoleRef  string // role id or name; "" = the whole wiki
	Round    string // a Rounds id; "" = General
	Question string
	CallID   string // the call this line belongs to; "" = a line on its own
	// Code —— the access code this interview session was opened with: the card reads the tailored
	// résumé of the application that code is bound to (cue-resume-grounding). "" = no binding, the
	// card behaves as before.
	Code        string
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

// Prepare —— loads the session's deck: its note count and the names for Whisper's prompt. A bound
// code scopes the deck to what that code reads; otherwise the role ref does.
func (a *Assistant) Prepare(ctx context.Context, ownerID, ref, code string) (Prepared, error) {
	rd, err := a.deckFor(ctx, ownerID, ref, code)
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
	// Show which scope is active: the role ref's, or the bound code's (both carry an ID; the
	// whole-wiki fallback does not).
	if rd.role.ID != "" {
		p.Role = &rd.role
	}
	return p, nil
}

// Applications —— the committed applications the owner can bind this session to (the start screen's
// picker), newest first.
func (a *Assistant) Applications(ctx context.Context, ownerID string) ([]AppOption, error) {
	if a.ports.Applications == nil {
		return []AppOption{}, nil
	}
	return a.ports.Applications(ctx, ownerID)
}

// Prompt —— a question's system prompt and what went into it.
type Prompt struct {
	// noticed —— the applied job this line named, which the call locks onto (nil = none new).
	noticed *Job
	Heard   Heard
	System  string
	Context string
	// resumeCard —— the deterministic full résumé recap the background card must carry (卡片完整度);
	// "" when no résumé is bound. Cue appends it for a background question so completeness never
	// depends on the model's sampling.
	resumeCard string
	role       Role
	// messages —— what assistant.cue sends after the system prompt.
	messages []Message
	Sources  []string
	Named    []string
	// NamedProjects —— the owner-project slugs the question named; finalize only keeps a project
	// note's From when the question named that project (cue-generic-fabrication-fix V1 threshold).
	NamedProjects []string
	Matrix        bool
	// HasPosting —— the packet carried posted facts; a process answer may cite the role's posting.
	HasPosting bool
}

// posting —— the citation for the role's posting when the packet carried posted facts, else "".
func (p *Prompt) posting() string {
	if p.HasPosting {
		return postingCitation
	}
	return ""
}

// Context —— the prompt assistant.cue would send for this question; nothing is written.
func (a *Assistant) Context(ctx context.Context, ownerID string, q *Ask) (Prompt, error) {
	round, err := checkAsk(q)
	if err != nil {
		return Prompt{}, err
	}
	rd, err := a.deckWithNotes(ctx, ownerID, q.RoleRef, q.Code)
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
	// The tailored résumé (cue-resume-grounding) leads the context, ahead of the posting and notes.
	// Applied per question, after the role-keyed deck: bound to the session's code, not the role.
	if screen.resume != "" {
		b.context = screen.resume + "\n\n" + b.context
	}
	extra := ""
	if t := jsTrim(q.UserContext); t != "" {
		extra = "\n\n## Also from the user\n" + t
	}
	return Prompt{
		System:  systemPrompt(b.context+extra, round.closingRules()),
		Context: b.context, Sources: b.sources, Named: b.named, Matrix: b.matrix,
		NamedProjects: b.namedProjects, HasPosting: b.hasPosting,
		role: rd.role, noticed: screen.noticed, Heard: heard,
		resumeCard: screen.resumeCard,
	}
}

// deckWithNotes —— the session's deck; a scope that holds nothing is an error, not an empty card.
func (a *Assistant) deckWithNotes(
	ctx context.Context, ownerID, ref, code string,
) (roleDeck, error) {
	rd, err := a.deckFor(ctx, ownerID, ref, code)
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
	noticed    *Job
	text       string
	resume     string   // tailored résumé for the context block, "" = none (cue-resume)
	resumeCard string   // deterministic full recap for the card (卡片完整度), "" = none
	companies  []string // every applied job's company: names the rewrite may restore
}

// callScreen —— the phone-screen block: the script, the job the call is locked onto (or the applied
// job this line names, noticed: assistant.cue then locks the call onto it) for the homework block,
// and the tailored résumé of the application this session's code is bound to.
func (a *Assistant) callScreen(ctx context.Context, ownerID string, q *Ask) (screenPick, error) {
	screen, err := a.ports.Screen(ctx, ownerID)
	if err != nil {
		return screenPick{}, err
	}
	job, err := a.lockedJob(ctx, ownerID, q.CallID)
	if err != nil {
		return screenPick{}, err
	}
	pick := pickScreen(&screen, &job, q.Question)
	doc, err := a.resumeFor(ctx, ownerID, q.Code)
	if err != nil {
		return screenPick{}, err
	}
	if doc != nil {
		pick.resume, pick.resumeCard = doc.render(), doc.renderCard()
	}
	return pick, nil
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

// resumeFor —— the résumé the code is bound to, or nil: no code, the code binds no
// application, or an empty résumé (the card then behaves as before). Read every
// question (no deck cache) so an edit shows at once; the caller renders it twice.
func (a *Assistant) resumeFor(ctx context.Context, ownerID, code string) (*Resume, error) {
	if code == "" {
		return nil, nil
	}
	r, err := a.ports.Resume(ctx, ownerID, code)
	if errors.Is(err, ErrNoResume) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if r.isEmpty() {
		return nil, nil
	}
	return &r, nil
}

// lockedJob —— the job the call is locked onto; none for a line on its own.
func (a *Assistant) lockedJob(ctx context.Context, ownerID, callID string) (Job, error) {
	if callID == "" {
		return Job{}, nil
	}
	return a.Feed.lockedJob(ctx, ownerID, callID)
}
