// fiber_jobs.go —— the owner-side jobs.* tools.
// 7 tools: register_source / list_sources / unregister_source / fetch_new /
// fetch_result / show / discard. owner-only. See docs/design/job-loop.md for details.

// Package jobsmcp —— the job loop's owner tools (jobs.* + resume.* + assistant.push +
// applications.commit) as dispatcher ops, and their result wire. Named jobsmcp to avoid
// colliding with internal/mcp; callers write jobsmcp.OwnerOps / jobsmcp.ApplicationOps.
package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// jobsFiber —— the jobs.* tools; OwnerOps (ops.go) lifts them into dispatcher ops.
type jobsFiber struct {
	jobs *jobsuc.JobsDeps
	log  *slog.Logger
}

func (c *jobsFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{
		c.registerSourceBinding(), c.listSourcesBinding(),
		c.unregisterSourceBinding(), c.fetchNewBinding(), c.fetchResultBinding(),
		c.showBinding(), c.discardBinding(),
	}
}

// ───── jobs.register_source ─────────────────────────────────────

func (c *jobsFiber) registerSourceBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name: "jobs.register_source", Danger: "write",
		Description: "Register a job source. kind ∈ greenhouse|lever|ashby|remoteok|wwr|" +
			"hn_hiring|smartrecruiters|workable. config: {company} for ats; " +
			"{categories:[]} for wwr; {} for remoteok / hn_hiring.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"kind":{"type":"string","description":"Source kind."},
				"label":{"type":"string","description":"Owner-friendly label."},
				"config":{"type":"object","description":"Per-kind config object."}
			},
			"required":["kind","label"]
		}`),
		Handler: c.handleRegisterSource,
	}
}

type registerSourceArgsWire struct {
	Kind   string          `json:"kind"`
	Label  string          `json:"label"`
	Config json.RawMessage `json:"config"`
}

func (c *jobsFiber) handleRegisterSource(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	args, perr := parseRegisterSourceCapArgs(raw)
	if perr != nil {
		return registry.MCPError(perr.Error())
	}
	src, err := jobsuc.RegisterJobSource(ctx, *c.jobs, &jobsmodel.CreateJobSourceInput{
		OwnerID: ownerID, Kind: args.Kind, Config: args.Config, Label: args.Label,
	})
	if err != nil {
		return jobsCapErrToResult(c.log, err, "register_source")
	}
	return mcputil.MarshalResult(c.log, "jobs.register_source", jobSourceView(&src))
}

func parseRegisterSourceCapArgs(
	raw json.RawMessage,
) (registerSourceArgsWire, error) {
	var args registerSourceArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Kind == "" {
		return args, errors.New("kind is required")
	}
	if args.Label == "" {
		return args, errors.New("label is required")
	}
	if len(args.Config) == 0 {
		args.Config = json.RawMessage(`{}`)
	}
	return args, nil
}

// ───── jobs.list_sources ───────────────────────────────────────

func (c *jobsFiber) listSourcesBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name:        "jobs.list_sources",
		Danger:      "read",
		Description: "List all job sources the owner has registered.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleListSources,
	}
}

func (c *jobsFiber) handleListSources(
	ctx context.Context, ownerID string, _ json.RawMessage,
) registry.MCPResult {
	list, err := jobsuc.ListJobSources(ctx, *c.jobs, ownerID)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "list_sources")
	}
	out := make([]jobSourceViewT, 0, len(list))
	for i := range list {
		out = append(out, jobSourceView(&list[i]))
	}
	return mcputil.MarshalResult(c.log, "jobs.list_sources",
		map[string]any{"sources": out})
}

// ───── jobs.unregister_source ──────────────────────────────────

func (c *jobsFiber) unregisterSourceBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name:        "jobs.unregister_source",
		Danger:      "destructive",
		Description: "Delete a registered job source (and its dedup fingerprints).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"source_id":{"type":"string","description":"Source id"}
			},
			"required":["source_id"]
		}`),
		Handler: c.handleUnregisterSource,
	}
}

type sourceIDArgsWire struct {
	SourceID string `json:"source_id"`
}

func (c *jobsFiber) handleUnregisterSource(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args sourceIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if args.SourceID == "" {
		return registry.MCPError("source_id is required")
	}
	if err := jobsuc.UnregisterJobSource(ctx, *c.jobs, ownerID, args.SourceID); err != nil {
		return jobsCapErrToResult(c.log, err, "unregister_source")
	}
	return mcputil.MarshalResult(c.log, "jobs.unregister_source", map[string]bool{"ok": true})
}

// jobs.fetch_new lives in cap_jobs_fetch.go — it's the only one of the six
// that has to answer both "what does today's board look like" and "what
// happened during this fetch", so its args and receipt are both thicker
// than the other five.

// ───── jobs.show ────────────────────────────────────────────────

func (c *jobsFiber) showBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name:        "jobs.show",
		Danger:      "read",
		Description: "Look up a job by cache_id; returns full JD body.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"cache_id":{"type":"string","description":"cache_id"}
			},
			"required":["cache_id"]
		}`),
		Handler: c.handleShow,
	}
}

type cacheIDArgsWire struct {
	CacheID string `json:"cache_id"`
}

func (c *jobsFiber) handleShow(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args cacheIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if args.CacheID == "" {
		return registry.MCPError("cache_id is required")
	}
	job, err := jobsuc.ShowJob(ctx, *c.jobs, ownerID, args.CacheID)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "show")
	}
	return mcputil.MarshalResult(c.log, "jobs.show", fetchedJobToView(&job))
}

// ───── jobs.discard ─────────────────────────────────────────────

func (c *jobsFiber) discardBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name:        "jobs.discard",
		Danger:      "write", // a pool row expires in a day anyway
		Description: "Drop a job from the cache pool (owner reviewed and rejected).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"cache_id":{"type":"string","description":"cache_id"}
			},
			"required":["cache_id"]
		}`),
		Handler: c.handleDiscard,
	}
}

func (c *jobsFiber) handleDiscard(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args cacheIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if args.CacheID == "" {
		return registry.MCPError("cache_id is required")
	}
	if err := jobsuc.DiscardJob(ctx, *c.jobs, ownerID, args.CacheID); err != nil {
		return jobsCapErrToResult(c.log, err, "discard")
	}
	return mcputil.MarshalResult(c.log, "jobs.discard", map[string]bool{"ok": true})
}

// ───── error mapping ───────────────────────────────────────────

func jobsCapErrToResult(log *slog.Logger, err error, op string) registry.MCPResult {
	if msg, ok := jobsCapClientErr(err); ok {
		return registry.MCPError(msg)
	}
	if errors.Is(err, jobsuc.ErrFetchNotFound) {
		return registry.MCPError("no such fetch: pass the job_ids jobs.fetch_new returned")
	}
	log.Error("cap jobs."+op, "err", err)
	return registry.MCPError("jobs." + op + " failed")
}

func jobsCapClientErr(err error) (string, bool) {
	switch {
	case errors.Is(err, jobsmodel.ErrJobSourceKindInvalid):
		return "kind invalid", true
	case errors.Is(err, jobsmodel.ErrJobSourceConfigInvalid):
		return "config invalid: " + err.Error(), true
	case errors.Is(err, jobsmodel.ErrJobSourceNotFound):
		return "source not found", true
	case errors.Is(err, jobsmodel.ErrJobCacheMiss):
		return "job cache miss (expired or never existed)", true
	}
	return "", false
}
