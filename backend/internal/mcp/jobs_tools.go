// jobs_tools.go —— MCP tools 的 jobs.* group：register_source / list_sources /
// fetch_new / show / discard / unregister_source。
//
// 见 docs/design/job-loop.md "MCP tool surface" 节。这些 tool 都返结构化
// JSON 让 Claude 直接消费。

package mcp

import (
	"context"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const errUnauthorized = "unauthorized"

func jobsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(jobsRegisterSourceTool(), wrapTool(invokeJobsRegisterSource(deps)))
	srv.AddTool(jobsListSourcesTool(), wrapTool(invokeJobsListSources(deps)))
	srv.AddTool(jobsUnregisterSourceTool(), wrapTool(invokeJobsUnregisterSource(deps)))
	srv.AddTool(jobsFetchNewTool(), wrapTool(invokeJobsFetchNew(deps)))
	srv.AddTool(jobsShowTool(), wrapTool(invokeJobsShow(deps)))
	srv.AddTool(jobsDiscardTool(), wrapTool(invokeJobsDiscard(deps)))
}

// ---- jobs.register_source --------------------------------------------------

func jobsRegisterSourceTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"jobs.register_source",
		mcpgo.WithDescription(
			"Register a job source. kind ∈ greenhouse|lever|ashby|remoteok|wwr|hn_hiring|"+
				"smartrecruiters|workable. config shape depends on kind: "+
				"{company:string} for ats kinds; {categories:[string]} for wwr; "+
				"{} for remoteok / hn_hiring.",
		),
		mcpgo.WithString("kind", mcpgo.Required(),
			mcpgo.Description("Source kind (see description).")),
		mcpgo.WithObject("config", mcpgo.Description("Per-kind config object.")),
		mcpgo.WithString("label", mcpgo.Required(),
			mcpgo.Description("Owner-friendly label, e.g., 'Vercel careers'.")),
	)
}

func invokeJobsRegisterSource(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		kind, rerr := req.RequireString("kind")
		if rerr != nil {
			return mcpgo.NewToolResultError("kind is required")
		}
		label, rerr := req.RequireString("label")
		if rerr != nil {
			return mcpgo.NewToolResultError("label is required")
		}
		cfgRaw := req.GetArguments()["config"]
		cfg, _ := cfgRaw.(map[string]any)
		if cfg == nil {
			cfg = map[string]any{}
		}
		src, err := usecases.RegisterJobSource(ctx, deps.Jobs, &domain.CreateJobSourceInput{
			OwnerID: ownerID, Kind: kind, Config: cfg, Label: label,
		})
		if err != nil {
			return jobsErrToResult(err, deps, "register_source")
		}
		return marshalResult(deps, jobSourceView(src))
	}
}

// ---- jobs.list_sources ----------------------------------------------------

func jobsListSourcesTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"jobs.list_sources",
		mcpgo.WithDescription("List all job sources the owner has registered."),
	)
}

func invokeJobsListSources(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		list, err := usecases.ListJobSources(ctx, deps.Jobs, ownerID)
		if err != nil {
			return jobsErrToResult(err, deps, "list_sources")
		}
		out := make([]jobSourceViewT, 0, len(list))
		for _, s := range list {
			out = append(out, jobSourceView(s))
		}
		return marshalResult(deps, jobsListResp{Sources: out})
	}
}

// ---- jobs.unregister_source -----------------------------------------------

func jobsUnregisterSourceTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"jobs.unregister_source",
		mcpgo.WithDescription("Delete a registered job source (and its dedup fingerprints)."),
		mcpgo.WithString("source_id", mcpgo.Required(),
			mcpgo.Description("Source id returned by register_source.")),
	)
}

func invokeJobsUnregisterSource(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		sid, rerr := req.RequireString("source_id")
		if rerr != nil {
			return mcpgo.NewToolResultError("source_id is required")
		}
		if err := usecases.UnregisterJobSource(ctx, deps.Jobs, ownerID, sid); err != nil {
			return jobsErrToResult(err, deps, "unregister_source")
		}
		return marshalResult(deps, okResp{OK: true})
	}
}

// ---- jobs.fetch_new -------------------------------------------------------

func jobsFetchNewTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"jobs.fetch_new",
		mcpgo.WithDescription(
			"Fetch new (since-last-seen) jobs from one or all registered sources. "+
				"Returns FetchedJob array with cache_id refs; cached for 24h.",
		),
		mcpgo.WithString("source_id",
			mcpgo.Description("Optional: specific source id (omit = all sources).")),
	)
}

func invokeJobsFetchNew(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		var sidPtr *string
		if sid := req.GetString("source_id", ""); sid != "" {
			sidPtr = &sid
		}
		jobs, err := usecases.FetchNewJobs(ctx, deps.Jobs, ownerID, sidPtr)
		if err != nil {
			return jobsErrToResult(err, deps, "fetch_new")
		}
		out := make([]fetchedJobView, 0, len(jobs))
		for _, j := range jobs {
			out = append(out, fetchedJobToView(j))
		}
		return marshalResult(deps, jobsFetchResp{Jobs: out})
	}
}

// ---- jobs.show ------------------------------------------------------------

func jobsShowTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"jobs.show",
		mcpgo.WithDescription("Look up a job by cache_id; returns full JD body."),
		mcpgo.WithString("cache_id", mcpgo.Required(),
			mcpgo.Description("cache_id returned by jobs.fetch_new.")),
	)
}

func invokeJobsShow(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		cid, rerr := req.RequireString("cache_id")
		if rerr != nil {
			return mcpgo.NewToolResultError("cache_id is required")
		}
		job, err := usecases.ShowJob(ctx, deps.Jobs, ownerID, cid)
		if err != nil {
			return jobsErrToResult(err, deps, "show")
		}
		return marshalResult(deps, fetchedJobToView(job))
	}
}

// ---- jobs.discard ---------------------------------------------------------

func jobsDiscardTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"jobs.discard",
		mcpgo.WithDescription("Drop a job from the cache pool (owner reviewed and rejected)."),
		mcpgo.WithString("cache_id", mcpgo.Required()),
	)
}

func invokeJobsDiscard(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		cid, rerr := req.RequireString("cache_id")
		if rerr != nil {
			return mcpgo.NewToolResultError("cache_id is required")
		}
		if err := usecases.DiscardJob(ctx, deps.Jobs, ownerID, cid); err != nil {
			return jobsErrToResult(err, deps, "discard")
		}
		return marshalResult(deps, okResp{OK: true})
	}
}

// ---- view helpers / error mapping -----------------------------------------

func jobsErrToResult(err error, deps *Deps, op string) *mcpgo.CallToolResult {
	switch {
	case errors.Is(err, domain.ErrJobSourceKindInvalid):
		return mcpgo.NewToolResultError("kind invalid")
	case errors.Is(err, domain.ErrJobSourceConfigInvalid):
		return mcpgo.NewToolResultError("config invalid: " + err.Error())
	case errors.Is(err, domain.ErrJobSourceNotFound):
		return mcpgo.NewToolResultError("source not found")
	case errors.Is(err, domain.ErrJobCacheMiss):
		return mcpgo.NewToolResultError("job cache miss (expired or never existed)")
	default:
		deps.Log.Error("mcp jobs."+op, "err", err)
		return mcpgo.NewToolResultError(fmt.Sprintf("jobs.%s failed", op))
	}
}
