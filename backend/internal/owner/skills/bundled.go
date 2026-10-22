// bundled.go —— the skills StandMeet ships. A bundled skill is plain text in the same store as an
// owner's own (SourceBundled is metadata, not privilege). The first one is the interview loop: the
// playbook an owner-AI follows to run a job's interview prep. Its body names the public MCP tools
// to call — the skill grants nothing, it only tells the agent which door to knock on.

package skills

import (
	"context"
	"errors"
)

const interviewLoopDesc = "Run a job application's interview prep end to end: pull the packet, " +
	"ground every cue card in the tailored résumé, admit gaps instead of bridging them."

// bundled —— the skills every instance seeds at claim.
var bundled = []NewInput{{
	Slug:        "interview-loop",
	Name:        "Interview loop",
	Source:      SourceBundled,
	Description: interviewLoopDesc,
	Body:        interviewLoopBody,
}}

// interviewLoopBody —— the interview-loop playbook. One instruction per line; it points at the
// public tools (jobs.interview_packet, applications.*); it reaches into no subsystem itself.
const interviewLoopBody = `# Interview loop

You run the interview prep for ONE application at a time. Follow these steps in order.

## 1. Pull the packet
Call ` + "`jobs.interview_packet`" + ` for the application. The packet carries the tailored
résumé that was sent, the job description, and the owner's role notes. Read all three first.

## 2. Ground every claim, in this order
For any question, ground your answer in this order and stop at the first layer that answers it:
1. the tailored résumé actually sent for this application;
2. the job packet / posted description (facts about the role, the process, the band);
3. the owner's role notes.
Never jump a layer. A résumé line beats a general note.

## 3. Admit a gap; do not bridge it
If none of the three layers covers what is asked, say the owner has not covered it. Do NOT:
- restate the question's own frame back as if it were an answer;
- reach to a DIFFERENT experience because a generic word (detection, scale) is in both;
- lead with something the owner marked do-not-lead.
A named gap is a correct answer. A bridge that sounds confident is a wrong one.

## 4. Process questions use posted facts
"What's your expected comp / notice period / start date" — answer from the packet's posted
band and the owner's role notes, not from a guess and not from another role's numbers.

## 5. Stay honest
Round durations to the nearest whole year, never shade them down. Claim only what the evidence
covers: "built X" is not "led the team that built X" unless the notes say so. When unsure, ask.`

// SeedBundled —— ensure every bundled skill exists for this owner. Idempotent: a skill already
// there is left as is (bundled skills are replaced by a release, not reseeded). Called at claim.
func SeedBundled(ctx context.Context, svc *Service, ownerID string) error {
	if svc == nil {
		return nil
	}
	for i := range bundled {
		_, err := svc.New(ctx, ownerID, &bundled[i])
		if err != nil && !errors.Is(err, ErrSlugTaken) {
			return err
		}
	}
	return nil
}
