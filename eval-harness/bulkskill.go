// bulkskill.go —— an owner skill whose **result is large enough to blow the
// context past the compaction threshold**.
//
// The bill (F-D-10): in prod, two external MCP tools returned 374871 + 3505 bytes,
// followed immediately by `context compacted before_msgs:5 after_msgs:2` in the
// log, then the AI's whole turn was just *"I'm here — what would you like to
// dig into next?"* —— the question went unanswered.
//
// The mechanism is in agent_compaction.go: compaction's tail step `tailPlainTurns`
// **necessarily** drops tool traces (leaving half a tool result whose call is
// gone, which the provider will reject the whole request over). So the only
// place that returned tool's substance can survive is the summary. Item 6 of
// the task list was written for exactly this.
//
// This fixture is that "large tool result": an external due-diligence report that
// crosses the 32K threshold on a single read, with **exactly one** occurrence of
// two facts buried inside it. Whether that turn can still answer them after
// compaction is what this eval judges. Only a real model can judge it: the stand-in
// doesn't actually summarize (everything survives in the echo), so on that side
// this assertion is unconditionally true.
package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// The two facts occur **exactly once** in the report. Compaction is quizzed on
// exactly these; the filler paragraphs must never contain these two strings
// (otherwise the assertion would be judging the filler, not recall).
const (
	dossierThroughputFact = "4.7 million transactions per day"
	dossierOutageFact     = "41 minutes"
)

// dossierTargetChars —— the body length of the report.
//
// This number is **part of the pass/fail criterion**, not filled in casually:
//   - The first model call has no usage yet to go by; eino estimates chars/4
//     (estimateTokenCount). The leg's 88K-character history ≈ 22K tokens, and
//     with system + tool declarations (measured at 4K+) that's still under 32K —
//     so the first call does **not** trigger compaction, giving the tool a chance
//     to run first.
//   - This report's 44K characters ≈ 11K tokens, which pushes past 32K once it
//     lands after the real usage — so compaction triggers only **after the tool
//     result is already in the window**. That's exactly the shape of the prod case.
//
// Both sides keep several K of margin; the shell-side assertion checks this
// ordering itself, and a bad estimate would go red on the ordering.
const dossierTargetChars = 44000

// dossierSkill —— an external report outside the owner's corpus, turned into a skill.
//
// Why a skill rather than an external MCP: this eval judges **whether compaction
// carries the tool return's substance forward**, and that has nothing to do with
// where the tool comes from; the skill path doesn't need a separate process, and
// the result size stays entirely under our control.
func dossierSkill() *agentcore.VisitorSkillSpec {
	return &agentcore.VisitorSkillSpec{
		Name: "fetch_dossier",
		Description: "Fetch the full text of the Nimbus Data due-diligence dossier the owner keeps " +
			"outside the corpus. Call it whenever the visitor asks about the dossier, its throughput " +
			"figures, or the November outage — the numbers exist nowhere else.",
		Prompt: "You have a fetch_dossier skill that returns the full due-diligence dossier. " +
			"Call it before answering anything about the dossier's figures.",
		Language: "python",
		Content:  "print(open('dossier.txt').read())",
		Stdout:   dossierStdout(),
		Params: []agentcore.VisitorSkillParam{
			{Name: "section", Type: "string", Description: "section to fetch, or 'full'", Required: false},
		},
	}
}

// onceSpentStdout —— what the one-shot report's second call returns.
//
// Says plainly "you already fetched this; that text only exists in this
// conversation", rather than just dropping an "error occurred": the former lets
// the model decide whether to own up to it, the latter only makes it retry.
// Real-world signed links / expired reports answer exactly this way.
const onceSpentStdout = `{"error":"this dossier link was one-shot and has already been ` +
	`spent; the text fetched earlier in this conversation is the only copy"}`

// dossierStdout —— what the skill prints: a long report wrapped in JSON.
func dossierStdout() string {
	b, err := json.Marshal(map[string]string{
		"section": "full",
		"text":    dossierText(),
	})
	if err != nil { // Marshaling a plain string map can't fail; if it ever does, let it surface.
		panic(fmt.Sprintf("dossier marshal: %v", err))
	}
	return string(b)
}

// dossierFillerParas —— filler paragraph templates. Worded the way a **due-diligence
// report** actually reads, not gibberish: the summarizing model needs real material to
// compress, so compaction is genuinely doing what it normally does.
var dossierFillerParas = []string{
	"Section %d — Reconciliation coverage. The ledger pipeline replays each settlement window " +
		"against the acquirer statement and the internal journal, and files every unmatched leg " +
		"into a review queue that the on-call engineer clears within one business day. Coverage " +
		"held above 99 percent across the quarter, with the residue concentrated in cross-border " +
		"refunds where the acquirer reports a net amount and the journal keeps the gross.",
	"Section %d — Operational posture. Deploys go out behind a progressive rollout; the first " +
		"cohort is internal traffic only, the second is a single low-volume merchant, and the " +
		"remainder follows once the error budget for the window is untouched. Rollback is a single " +
		"command and is exercised on purpose once a month so that nobody meets it for the first " +
		"time during an incident.",
	"Section %d — Data retention. Settlement artefacts are kept hot for ninety days and cold for " +
		"seven years, which is what the payments regulator asks for in this market. Access to the " +
		"cold tier is broker-mediated and every read is attributed to a named person, so a request " +
		"for an old statement leaves a trail that survives staff turnover.",
	"Section %d — Vendor dependencies. Two acquirers, one card network gateway, and a fraud " +
		"scoring service sit on the critical path. Each has a documented degraded mode: the second " +
		"acquirer takes over routing within the same settlement window, the gateway falls back to " +
		"a batched submission, and the fraud service fails closed for high-value baskets only.",
}

// dossierText —— the report body: a header + the paragraph with the two facts
// buried in it + filler padded out to the target length.
func dossierText() string {
	var b strings.Builder
	b.WriteString("NIMBUS DATA — EXTERNAL DUE-DILIGENCE DOSSIER (confidential working copy)\n\n")
	b.WriteString("Section 1 — Platform scale and the November incident. " +
		"At the close of the last fiscal quarter the billing and payments platform sustained a peak of " +
		dossierThroughputFact + ", measured at the settlement boundary rather than at the edge. " +
		"The only customer-visible interruption in that period began on 3 November, when a schema " +
		"migration held a lock on the settlement table for longer than the deploy window allowed; " +
		"authorisations continued but capture was queued, and the interruption lasted " +
		dossierOutageFact + " end to end. Neither figure appears in any public filing.\n\n")
	for i := 2; b.Len() < dossierTargetChars; i++ {
		para := dossierFillerParas[(i-2)%len(dossierFillerParas)]
		b.WriteString(fmt.Sprintf(para, i))
		b.WriteString("\n\n")
	}
	return b.String()
}
