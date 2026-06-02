// cap_jobs.go —— Phase E-10: owner-side jobs.* Capability。
// 6 tools: register_source / list_sources / unregister_source / fetch_new /
// show / discard。owner-only。详见 docs/design/job-loop.md。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capJobsBundle = "jobs.bundle"

type jobsCapability struct {
	jobs *usecases.JobsDeps
	log  *slog.Logger
}

func newJobsCapability(jobs *usecases.JobsDeps, log *slog.Logger) *jobsCapability {
	return &jobsCapability{jobs: jobs, log: log}
}

func (*jobsCapability) ID() string               { return capJobsBundle }
func (*jobsCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*jobsCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, agentskills.ErrHidden
}

func (*jobsCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*jobsCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *jobsCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.registerSourceBinding(), c.listSourcesBinding(),
		c.unregisterSourceBinding(), c.fetchNewBinding(),
		c.showBinding(), c.discardBinding(),
	}
}

// ───── jobs.register_source ─────────────────────────────────────

func (c *jobsCapability) registerSourceBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	args, perr := parseRegisterSourceCapArgs(raw)
	if perr != nil {
		return agentskills.MCPError(perr.Error())
	}
	src, err := usecases.RegisterJobSource(ctx, *c.jobs, &domain.CreateJobSourceInput{
		OwnerID: ownerID, Kind: args.Kind, Config: args.Config, Label: args.Label,
	})
	if err != nil {
		return jobsCapErrToResult(c.log, err, "register_source")
	}
	return marshalCapResult(c.log, "jobs.register_source", jobSourceView(&src))
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

func (c *jobsCapability) listSourcesBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "jobs.list_sources",
		Description: "List all job sources the owner has registered.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleListSources,
	}
}

func (c *jobsCapability) handleListSources(
	ctx context.Context, ownerID string, _ json.RawMessage,
) agentskills.MCPResult {
	list, err := usecases.ListJobSources(ctx, *c.jobs, ownerID)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "list_sources")
	}
	out := make([]jobSourceViewT, 0, len(list))
	for i := range list {
		out = append(out, jobSourceView(&list[i]))
	}
	return marshalCapResult(c.log, "jobs.list_sources",
		map[string]any{"sources": out})
}

// ───── jobs.unregister_source ──────────────────────────────────

func (c *jobsCapability) unregisterSourceBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	var args sourceIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.SourceID == "" {
		return agentskills.MCPError("source_id is required")
	}
	if err := usecases.UnregisterJobSource(ctx, *c.jobs, ownerID, args.SourceID); err != nil {
		return jobsCapErrToResult(c.log, err, "unregister_source")
	}
	return marshalCapResult(c.log, "jobs.unregister_source", map[string]bool{"ok": true})
}

// ───── jobs.fetch_new ──────────────────────────────────────────

func (c *jobsCapability) fetchNewBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "jobs.fetch_new",
		Description: "Fetch new (since-last-seen) jobs from one or all registered sources. " +
			"Returns FetchedJob array with cache_id refs; cached for 24h.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"source_id":{"type":"string",
					"description":"Optional specific source id (omit = all sources)."}
			}
		}`),
		Handler: c.handleFetchNew,
	}
}

func (c *jobsCapability) handleFetchNew(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	var args sourceIDArgsWire
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return agentskills.MCPError("invalid arguments: " + err.Error())
		}
	}
	var sidPtr *string
	if args.SourceID != "" {
		s := args.SourceID
		sidPtr = &s
	}
	jobs, err := usecases.FetchNewJobs(ctx, *c.jobs, ownerID, sidPtr)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "fetch_new")
	}
	return marshalCapResult(c.log, "jobs.fetch_new",
		map[string]any{"jobs": fetchedJobViews(jobs)})
}

// ───── jobs.show ────────────────────────────────────────────────

func (c *jobsCapability) showBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	var args cacheIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.CacheID == "" {
		return agentskills.MCPError("cache_id is required")
	}
	job, err := usecases.ShowJob(ctx, *c.jobs, ownerID, args.CacheID)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "show")
	}
	return marshalCapResult(c.log, "jobs.show", fetchedJobToView(&job))
}

// ───── jobs.discard ─────────────────────────────────────────────

func (c *jobsCapability) discardBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	var args cacheIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.CacheID == "" {
		return agentskills.MCPError("cache_id is required")
	}
	if err := usecases.DiscardJob(ctx, *c.jobs, ownerID, args.CacheID); err != nil {
		return jobsCapErrToResult(c.log, err, "discard")
	}
	return marshalCapResult(c.log, "jobs.discard", map[string]bool{"ok": true})
}

// ───── error mapping ───────────────────────────────────────────

func jobsCapErrToResult(log *slog.Logger, err error, op string) agentskills.MCPResult {
	if msg, ok := jobsCapClientErr(err); ok {
		return agentskills.MCPError(msg)
	}
	log.Error("cap jobs."+op, "err", err)
	return agentskills.MCPError("jobs." + op + " failed")
}

func jobsCapClientErr(err error) (string, bool) {
	switch {
	case errors.Is(err, domain.ErrJobSourceKindInvalid):
		return "kind invalid", true
	case errors.Is(err, domain.ErrJobSourceConfigInvalid):
		return "config invalid: " + err.Error(), true
	case errors.Is(err, domain.ErrJobSourceNotFound):
		return "source not found", true
	case errors.Is(err, domain.ErrJobCacheMiss):
		return "job cache miss (expired or never existed)", true
	}
	return "", false
}
