// fiber_interview.go —— a practice interview's ledger ops (docs/design/deepinterview-engine.md):
// jobs.interview_packet feeds the engine; jobs.add_interview_report brings its report back.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

const interviewReach = "an owner-AI practice interview: the agent relays the engine's questions"

var (
	packetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"job_seen_id":{"type":"string"}},
		"required":["job_seen_id"]
	}`)
	reportSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"job_seen_id":{"type":"string"},
			"report":{"type":"string","description":"the engine's finished report, markdown"}
		},
		"required":["job_seen_id","report"]
	}`)
)

type interviewArgs struct {
	ID     string `json:"job_seen_id"`
	Report string `json:"report"`
}

type reportOut struct {
	ID    string `json:"job_seen_id"`
	Added bool   `json:"added"`
}

// InterviewOps —— jobs.interview_packet, jobs.add_interview_report.
func InterviewOps(d *jobsuc.InterviewDeps, log *slog.Logger) []fp.Op {
	return []fp.Op{{
		ID: "jobs.interview_packet", Kind: fp.Read, Reach: fp.Only(interviewReach, "mcp"),
		InputSchema: packetSchema,
		Description: "The practice-interview packet for a posting's ledger row: {fingerprint, " +
			"body}. body is JSON — the posting, its brief and homework, the assessment, and the " +
			"texts of the notes the engine may ask about (the cv, project root notes, cited " +
			"notes). fingerprint is the sha256 of body. Give both to the interview engine as is.",
		Invoke: packetInvoke(d, log),
	}, {
		ID: "jobs.add_interview_report", Kind: fp.Action, Danger: fp.DangerWrite,
		Reach: fp.Only(interviewReach, "mcp"), InputSchema: reportSchema,
		Description: "Append a finished practice-interview report to the posting's ledger row " +
			"(interview_reports). Earlier reports stay.",
		Invoke: reportInvoke(d, log),
	}}
}

func packetInvoke(d *jobsuc.InterviewDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in interviewArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		p, err := jobsuc.InterviewPacket(ctx, d, ownerID, in.ID)
		return ledgerResult(log, "jobs.interview_packet", p, err)
	}
}

func reportInvoke(d *jobsuc.InterviewDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in interviewArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		err := jobsuc.AddInterviewReport(ctx, d, ownerID, in.ID, in.Report)
		out := reportOut{ID: in.ID, Added: true}
		return ledgerResult(log, "jobs.add_interview_report", out, err)
	}
}
