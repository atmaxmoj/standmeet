// fiber_ledger.go —— the owner's seen ledger over MCP (job-loop roadmap 4.1, E8): jobs.record
// (Job Scout's postings in), jobs.annotate (the AI's assessment kept), jobs.history (the ledger
// read back by day), jobs.mark_company (do-not-apply).

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

const ledgerReach = "the panel reads the ledger through jobsadmin's listings history"

var recordSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"postings":{"type":"array","maxItems":200,"items":{"type":"object","properties":{
			"title":{"type":"string"},"company":{"type":"string"},"url":{"type":"string"},
			"location":{"type":"string"},"body_text":{"type":"string"},
			"source":{"type":"string","description":"where it was found: linkedin, wellfound, …"}
		},"required":["title","company","url"]}}
	},
	"required":["postings"]
}`)

var annotateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"job_seen_id":{"type":"string"},
		"score":{"type":"number"},
		"reason":{"type":"string"},
		"deductions":{"type":"array","items":{"type":"object","properties":{
			"points":{"type":"number"},"why":{"type":"string"}},"required":["points","why"]}},
		"cited_notes":{"type":"array","items":{"type":"string"},
			"description":"corpus paths the assessment rests on"},
		"flags":{"type":"array","items":{"type":"string"}},
		"interview_reports":{"type":"array","items":{"type":"string"}},
		"brief":{"type":"string",
			"description":"markdown: the picture of the job; see the job-description-reading guide"}
	},
	"required":["job_seen_id"]
}`)

var historyFilters = json.RawMessage(`{"type":"object","properties":{
	"from":{"type":"string","description":"first day, YYYY-MM-DD (UTC), inclusive"},
	"to":{"type":"string","description":"last day, YYYY-MM-DD (UTC), inclusive"},
	"status":{"type":"string","enum":["seen","discarded","applied"]}
}}`)

var markSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"company":{"type":"string"},
		"mark":{"type":"string","enum":["do_not_apply","none"],"description":"none clears it"},
		"note":{"type":"string"}
	},
	"required":["company","mark"]
}`)

// LedgerOps —— jobs.record, jobs.annotate, jobs.history, jobs.mark_company, jobs.suggest_sources.
func LedgerOps(d *jobsuc.JobsDeps, log *slog.Logger) []fp.Op {
	op := func(
		id string, danger fp.Danger, schema json.RawMessage, desc string, inv fp.Invoke,
	) fp.Op {
		return fp.Op{
			ID: id, Kind: fp.Action, Danger: danger, Reach: fp.Only(ledgerReach, "mcp"),
			InputSchema: schema, Description: desc, Invoke: inv,
		}
	}
	return []fp.Op{
		op("jobs.record", fp.DangerWrite, recordSchema, "Record postings found outside the "+
			"registered boards (Job Scout: LinkedIn, …) in the owner's seen ledger. The server "+
			"dedups on the canonical URL and on company+title+location: each result says whether "+
			"the posting is new, or when it was first seen. A recorded posting is never pooled "+
			"again by a board.", recordInvoke(d, log)),
		op("jobs.annotate", fp.DangerWrite, annotateSchema, "Keep the assessment of a posting on "+
			"its ledger row (job_seen_id from jobs.fetch_new, jobs.record or jobs.history): "+
			"score, reason, deductions, cited notes, flags, interview reports, brief. "+
			"Fields given replace "+
			"those fields; others stay. Never shown to a recruiter.", annotateInvoke(d, log)),
		op("jobs.history", fp.DangerRead, paging.Schema(historyFilters), "The owner's seen "+
			"ledger, newest first: every posting the boards or Job Scout showed, its status "+
			"(seen, discarded, applied) and its assessment. from / to narrow by the day it was "+
			"first seen.", historyInvoke(d, log)),
		op("jobs.mark_company", fp.DangerWrite, markSchema, "Mark a company the owner will not "+
			"apply to (do_not_apply), or clear the mark (none). Its postings then carry the flag "+
			"do_not_apply, and resume.draft for one needs override: true.", markInvoke(d, log)),
		op("jobs.suggest_sources", fp.DangerRead, json.RawMessage(`{"type":"object"}`),
			"Company boards (greenhouse, lever, ashby) that postings in the ledger link to and "+
				"the owner has not registered, most postings first. Each one is the kind and "+
				"company jobs.register_source takes.", suggestInvoke(d, log)),
		op("applications.save_answers", fp.DangerWrite, answersSchema, "Keep the answers an "+
			"application's form was filled with. jobs.show then offers the latest answer to the "+
			"same question on the next posting (previous_answer); a question marked confirm "+
			"still needs the owner's yes each time.", answersInvoke(d, log)),
	}
}

var answersSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"application_id":{"type":"string"},
		"answers":{"type":"array","items":{"type":"object","properties":{
			"question":{"type":"string"},"answer":{"type":"string"}},
			"required":["question","answer"]}}
	},
	"required":["application_id","answers"]
}`)

func answersInvoke(d *jobsuc.JobsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			ApplicationID string                 `json:"application_id"`
			Answers       []jobsmodel.FormAnswer `json:"answers"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		err := jobsuc.SaveAnswers(ctx, d, ownerID, args.ApplicationID, args.Answers)
		saved := map[string]int{"saved": len(args.Answers)}
		return ledgerResult(log, "applications.save_answers", saved, err)
	}
}

type postingWire struct {
	Title    string `json:"title"`
	Company  string `json:"company"`
	URL      string `json:"url"`
	Location string `json:"location"`
	BodyText string `json:"body_text"`
	Source   string `json:"source"`
}

func recordInvoke(d *jobsuc.JobsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			Postings []postingWire `json:"postings"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		jobs := make([]jobsmodel.FetchedJob, 0, len(args.Postings))
		for _, p := range args.Postings {
			jobs = append(jobs, jobsmodel.FetchedJob{
				Title: p.Title, Company: p.Company, URL: p.URL, Location: p.Location,
				BodyText: p.BodyText, SourceKind: p.Source,
			})
		}
		out, err := jobsuc.RecordPostings(ctx, d, ownerID, jobs)
		results := map[string][]jobsmodel.Recorded{"results": out}
		return ledgerResult(log, "jobs.record", results, err)
	}
}

func annotateInvoke(d *jobsuc.JobsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			*jobsmodel.Annotations

			ID string `json:"job_seen_id"`
		}
		args.Annotations = &jobsmodel.Annotations{}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		row, err := jobsuc.AnnotatePosting(ctx, d, ownerID, args.ID, args.Annotations)
		return ledgerResult(log, "jobs.annotate", jobsmodel.SeenWireOf(&row), err)
	}
}

func historyInvoke(d *jobsuc.JobsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, err := paging.ParseArgs[struct {
			From   string `json:"from"`
			To     string `json:"to"`
			Status string `json:"status"`
		}](raw)
		if err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		f, err := jobsuc.SeenFilterOf(args.Filter.From, args.Filter.To, args.Filter.Status)
		if err != nil {
			return nil, err
		}
		page, err := jobsuc.History(ctx, d, ownerID, &f, args.Req)
		return ledgerResult(log, "jobs.history", paging.Each(page, jobsmodel.SeenWireOf), err)
	}
}

func suggestInvoke(d *jobsuc.JobsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		out, err := jobsuc.SuggestSources(ctx, d, ownerID)
		return ledgerResult(log, "jobs.suggest_sources",
			map[string][]jobsmodel.DirectSource{"suggestions": out}, err)
	}
}

func markInvoke(d *jobsuc.JobsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args jobsuc.CompanyMark
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		err := jobsuc.MarkCompany(ctx, d, ownerID, &args)
		return ledgerResult(log, "jobs.mark_company",
			map[string]string{"company": args.Company, "mark": args.Mark}, err)
	}
}

// ledgerErrs —— errors the caller can act on: their own words go back.
var ledgerErrs = []error{
	jobsuc.ErrNoPostings, jobsuc.ErrPostingFields, jobsuc.ErrBadDay, jobsuc.ErrBadStatus,
	jobsuc.ErrBadMark, jobsuc.ErrNothingToAnnotate, jobsmodel.ErrSeenNotFound, paging.ErrBadCursor,
	jobsmodel.ErrNoAnswers, jobsmodel.ErrApplicationNotFound,
}

func ledgerResult(log *slog.Logger, op string, v any, err error) (json.RawMessage, error) {
	for _, e := range ledgerErrs {
		if errors.Is(err, e) {
			return nil, errors.New(err.Error())
		}
	}
	if err != nil {
		log.Error(op, "err", err)
		return nil, errors.New(op + " failed")
	}
	out, merr := json.Marshal(v)
	if merr != nil {
		return nil, errors.New("encode result: " + merr.Error())
	}
	return out, nil
}
