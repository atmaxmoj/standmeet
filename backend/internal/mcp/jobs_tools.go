// jobs_tools.go —— MCP tools 的 jobs.* group：register_source / list_sources /
// fetch_new / show / discard / unregister_source。
//
// 见 docs/design/job-loop.md "MCP tool surface" 节。这些 tool 都返结构化
// JSON 让 Claude 直接消费。

package mcp

import (
	"context"
	"encoding/json"
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
		in, errResult := parseRegisterSourceArgs(ctx, req)
		if errResult != nil {
			return errResult
		}
		src, err := usecases.RegisterJobSource(ctx, deps.Jobs, in)
		if err != nil {
			return jobsErrToResult(err, deps, "register_source")
		}
		v := jobSourceView(&src)
		return marshalResult(deps, &v)
	}
}

// optionalSourceID lifts the "source_id" string arg into a *string,
// nil when absent (fetch_new defaults to "all sources" in that case).
func optionalSourceID(req *mcpgo.CallToolRequest) *string {
	sid := req.GetString("source_id", "")
	if sid == "" {
		return nil
	}
	return &sid
}

// parseRegisterSourceArgs validates the inbound MCP args and returns either
// the typed input or an error CallToolResult ready to send back.
func parseRegisterSourceArgs(
	ctx context.Context, req *mcpgo.CallToolRequest,
) (*domain.CreateJobSourceInput, *mcpgo.CallToolResult) {
	ownerID := OwnerIDFrom(ctx)
	if ownerID == "" {
		return nil, mcpgo.NewToolResultError(errUnauthorized)
	}
	pair, errResult := readRegisterSourceStrings(req)
	if errResult != nil {
		return nil, errResult
	}
	cfgBytes, marshalErr := marshalConfig(req)
	if marshalErr != nil {
		return nil, marshalErr
	}
	return &domain.CreateJobSourceInput{
		OwnerID: ownerID, Kind: pair.kind, Config: cfgBytes, Label: pair.label,
	}, nil
}

// registerSourceStrings is the {kind, label} pair pulled from the MCP args;
// helper returns it as one value to stay within function-result-limit=2.
type registerSourceStrings struct {
	kind  string
	label string
}

func readRegisterSourceStrings(
	req *mcpgo.CallToolRequest,
) (*registerSourceStrings, *mcpgo.CallToolResult) {
	k, kerr := req.RequireString("kind")
	if kerr != nil {
		return nil, mcpgo.NewToolResultError("kind is required")
	}
	l, lerr := req.RequireString("label")
	if lerr != nil {
		return nil, mcpgo.NewToolResultError("label is required")
	}
	return &registerSourceStrings{kind: k, label: l}, nil
}

// marshalConfig pulls the schemaless "config" object out of the MCP args and
// re-marshals to JSON bytes for the typed domain.CreateJobSourceInput.
// `{}`  when missing or wrong-typed.
func marshalConfig(req *mcpgo.CallToolRequest) ([]byte, *mcpgo.CallToolResult) {
	raw, ok := req.GetArguments()["config"].(map[string]any)
	if !ok || raw == nil {
		return []byte(`{}`), nil
	}
	out, err := json.Marshal(raw)
	if err != nil {
		return nil, mcpgo.NewToolResultError("config not serializable")
	}
	return out, nil
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
		for i := range list {
			out = append(out, jobSourceView(&list[i]))
		}
		return marshalResult(deps, &jobsListResp{Sources: out})
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
		return marshalResult(deps, &okResp{OK: true})
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
		sidPtr := optionalSourceID(req)
		jobs, err := usecases.FetchNewJobs(ctx, deps.Jobs, ownerID, sidPtr)
		if err != nil {
			return jobsErrToResult(err, deps, "fetch_new")
		}
		return marshalResult(deps, &jobsFetchResp{Jobs: fetchedJobViews(jobs)})
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
		v := fetchedJobToView(&job)
		return marshalResult(deps, &v)
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
		return marshalResult(deps, &okResp{OK: true})
	}
}

// ---- view helpers / error mapping -----------------------------------------

func jobsErrToResult(err error, deps *Deps, op string) *mcpgo.CallToolResult {
	if msg, ok := jobsClientErr(err); ok {
		return mcpgo.NewToolResultError(msg)
	}
	deps.Log.Error("mcp jobs."+op, "err", err)
	return mcpgo.NewToolResultError(fmt.Sprintf("jobs.%s failed", op))
}

// jobsClientErr maps known domain sentinels to user-facing messages.
// Returns (msg, true) when the error is one of the recognized sentinels.
func jobsClientErr(err error) (string, bool) {
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
