// rounds.go —— who is across the table decides what a card may draw on and how it talks (owner,
// 2026-10-19: "技术面那就只能聊自己懂得技术，但是hr就是没有自己不懂得技术"). matrix: false keeps the
// choice matrix off whatever the question names. keep: which kinds of note reach the model at
// all — a rule in the prompt alone held only some of the time, a note it never sees it cannot
// tell. The text is the desktop app's (src/utils/standmeet.js ROUNDS), verbatim.

package cues

import (
	"slices"
	"strings"
)

const (
	ownWork   = "your own work"
	collected = "someone else's (a fact you collected)"
	// GeneralRound —— the round when none is named.
	GeneralRound = "general"
)

// Round —— one interview round, as the picker lists it.
type Round struct {
	keep   func(kind string) bool
	ID     string `json:"id"`
	Label  string `json:"label"`
	Hint   string `json:"hint"`
	rules  string
	matrix bool
}

func keepNotCollected(kind string) bool { return kind != collected }
func keepOwnWork(kind string) bool      { return kind == ownWork }

// Rounds —— every round, in picker order.
var Rounds = []Round{
	{
		ID: "general", Label: "General", matrix: true,
		Hint: "Any note may help; the card picks its form.",
	},
	{
		ID: "recruiter", Label: "Recruiter / phone screen",
		Hint: "Who you are, what you want, whether the basics fit. Short and plain.",
		rules: "A recruiter screens fit: background in one breath, what you want" +
			" next, pay, location, work authorization, timeline. Facts straig" +
			"ht from the phone-screen script and the job brief. No technical " +
			"detail beyond naming what you work on; no choice matrix. At most" +
			" three short points.",
	},
	{
		ID: "behavioural", Label: "HR / behavioural",
		Hint: "Teamwork, conflict, motivation. Stories, no jargon.",
		rules: "The interviewer is not technical. Say what a technical thing ach" +
			"ieved in everyday words, as to a friend who is not an engineer (" +
			"what problem it solved, for whom, what changed): \"full control o" +
			"f the server\", not \"root\"; \"a background service\", not \"daemon\"." +
			" Never name flags, commands, code, protocols, sockets or interna" +
			"ls, and no choice matrix — the Context too. Prefer the STAR stor" +
			"y form, from your own work.",
	},
	{
		ID: "manager", Label: "Hiring manager",
		Hint: "Scope, ownership, trade-offs, impact.",
		rules: "The hiring manager wants what you owned, the trade-offs you made" +
			" and what they changed for users or the business. Name a technol" +
			"ogy only as the choice it was, with the reason; no internals and" +
			" no choice matrix.",
	},
	{
		ID: "technical", Label: "Technical deep-dive", matrix: true, keep: keepNotCollected,
		Hint: "Only technology your own work shows you used — with the details.",
		rules: "Talk only about technology your OWN WORK notes show you used, wi" +
			"th the details and numbers they give. A collected fact about a t" +
			"ool (a note marked \"someone else's\") is not you knowing it: when" +
			" the question names technology your own work does not show, say " +
			"plainly you have not used it, then the closest thing you did use" +
			", if your own work has one.",
	},
	{
		ID: "design", Label: "System design", matrix: true,
		Hint: "A new problem: reason from the patterns you have built.",
		rules: "The question is a design you have not built. Lead with the appro" +
			"ach, then the trade-offs, reasoning from patterns your OWN WORK " +
			"notes show you built. Mark what you have built (\"in StandMeet I…" +
			"\") apart from what you would do here; never present a collected " +
			"fact as your own experience.",
	},
	{
		ID: "executive", Label: "Founder / executive",
		Hint: "Judgement, product sense, why you do this.",
		rules: "A founder or executive weighs judgement and motivation: why this" +
			" problem, what you decided and why, what you learned. No impleme" +
			"ntation detail and no choice matrix.",
	},
	{
		ID: "mentor", Label: "Mentor", keep: keepOwnWork,
		Hint: "Only what you took part in yourself.",
		rules: "Talk only about what you took part in yourself: your OWN WORK no" +
			"tes. Never tell a collected fact (a note marked \"someone else's\"" +
			") or a general idea as your experience — not even as an example." +
			" If your own work has nothing on this, say so.",
	},
}

// RoundByID —— the round, or nil for an id no round has. "" is the General round.
func RoundByID(id string) *Round {
	if id == "" {
		id = GeneralRound
	}
	for i := range Rounds {
		if Rounds[i].ID == id {
			return &Rounds[i]
		}
	}
	return nil
}

// closingRules —— the closing orders of the system prompt: whose material is whose, then the
// round's own rules. They override the card format, so they go after it, not inside the notes.
func (r *Round) closingRules() string {
	own := ""
	if r.rules != "" {
		own = "\n\n**THIS ROUND: " + r.Label + "** — these orders override every format rule " +
			"above, on every line of the card (Context included):\n" + r.rules
	}
	return whose + "\n\n" + keepContext + own
}

func (r *Round) allows(u *unit) bool { return r.keep == nil || r.keep(noteKind(u)) }

// noteKind —— whose material a note is, from its tags and place. The vault's own convention
// tags someone else's facts `fact`.
func noteKind(u *unit) string {
	switch {
	case slices.Contains(u.tags, "fact"):
		return collected
	case isOwnWork(u):
		return ownWork
	case slices.ContainsFunc(u.tags, isIdeaTag):
		return "your idea"
	}
	return "your note"
}

func isOwnWork(u *unit) bool {
	return strings.HasPrefix(u.path, "software/project/") || slices.Contains(u.tags, "project")
}

func isIdeaTag(t string) bool { return t == "idea" || t == "original" }
