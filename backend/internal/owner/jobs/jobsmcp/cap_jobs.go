// cap_jobs.go —— Phase E-10: the owner-side jobs.* Capability.
// 6 tools: register_source / list_sources / unregister_source / fetch_new /
// show / discard. owner-only. See docs/design/job-loop.md for details.

// Package jobsmcp —— J.3: the jobs plugin's MCP capabilities + result wire.
// owner-only, 6+5+1 = 12 tools (jobs.* + resume.* + applications.commit).
// Moved out of internal/mcp; the package is named jobsmcp to avoid colliding
// with internal/mcp — external callers write jobsmcp.NewJobsCapability(deps, log).
package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

const capJobsBundle = "jobs.bundle"

type jobsCapability struct {
	jobs *jobsuc.JobsDeps
	log  *slog.Logger
}

// NewJobsCapability —— exposed to internal/mcp/register.go as of J.3 (the
// jobs plugin is registered into capreg.Registry across a package boundary).
func NewJobsCapability(jobs *jobsuc.JobsDeps, log *slog.Logger) capreg.Capability {
	return &jobsCapability{jobs: jobs, log: log}
}

func (*jobsCapability) ID() string          { return capJobsBundle }
func (*jobsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*jobsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*jobsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*jobsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *jobsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.registerSourceBinding(), c.listSourcesBinding(),
		c.unregisterSourceBinding(), c.fetchNewBinding(),
		c.showBinding(), c.discardBinding(),
	}
}

// ───── jobs.register_source ─────────────────────────────────────

func (c *jobsCapability) registerSourceBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "jobs.register_source",
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

func (c *jobsCapability) handleRegisterSource(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseRegisterSourceCapArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
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

func (c *jobsCapability) listSourcesBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "jobs.list_sources",
		Description: "List all job sources the owner has registered.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleListSources,
	}
}

func (c *jobsCapability) handleListSources(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
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

func (c *jobsCapability) unregisterSourceBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "jobs.unregister_source",
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

func (c *jobsCapability) handleUnregisterSource(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args sourceIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.SourceID == "" {
		return capreg.MCPError("source_id is required")
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

func (c *jobsCapability) showBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "jobs.show",
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

func (c *jobsCapability) handleShow(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args cacheIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.CacheID == "" {
		return capreg.MCPError("cache_id is required")
	}
	job, err := jobsuc.ShowJob(ctx, *c.jobs, ownerID, args.CacheID)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "show")
	}
	return mcputil.MarshalResult(c.log, "jobs.show", fetchedJobToView(&job))
}

// ───── jobs.discard ─────────────────────────────────────────────

func (c *jobsCapability) discardBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "jobs.discard",
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

func (c *jobsCapability) handleDiscard(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args cacheIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.CacheID == "" {
		return capreg.MCPError("cache_id is required")
	}
	if err := jobsuc.DiscardJob(ctx, *c.jobs, ownerID, args.CacheID); err != nil {
		return jobsCapErrToResult(c.log, err, "discard")
	}
	return mcputil.MarshalResult(c.log, "jobs.discard", map[string]bool{"ok": true})
}

// ───── error mapping ───────────────────────────────────────────

func jobsCapErrToResult(log *slog.Logger, err error, op string) capreg.MCPResult {
	if msg, ok := jobsCapClientErr(err); ok {
		return capreg.MCPError(msg)
	}
	log.Error("cap jobs."+op, "err", err)
	return capreg.MCPError("jobs." + op + " failed")
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
