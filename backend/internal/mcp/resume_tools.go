// resume_tools.go —— MCP tools 的 resume.* group：draft / update_draft / discard_draft。
//
// 见 docs/design/job-loop.md "MCP tool surface" 节。draft 和 update_draft 返多 content
// item：① TextContent JSON（draft_id / job_snapshot 等结构化数据），② EmbeddedResource
// 带 base64 PDF blob —— Claude 客户端可以直接展示给 owner。
//
// 关键设计：preview PDF 不落盘 —— 调用一次 tool 现场用 gopdf 渲染 bytes，每次都
// 走同一份 resumerender.Render()。Phase 3 commit 用同一渲染器渲染最终版（QR 换成
// 真 AccessCode URL），从而保证 owner preview 的 layout 跟 recruiter 收到的一致。

package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const (
	mimePDF              = "application/pdf"
	previewURIScheme     = "standmeet://resume-draft/" // suffix = draft id
	resumeContentArgKey  = "resume_content"
	resumeContentMissing = "resume_content is required"
)

func resumeTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(resumeDraftTool(), wrapTool(invokeResumeDraft(deps)))
	srv.AddTool(resumeUpdateDraftTool(), wrapTool(invokeResumeUpdateDraft(deps)))
	srv.AddTool(resumeDiscardDraftTool(), wrapTool(invokeResumeDiscardDraft(deps)))
}

// ---- resume.draft ---------------------------------------------------------

func resumeDraftTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"resume.draft",
		mcpgo.WithDescription(
			"Curate a tailored resume for a cached job and get a preview PDF. "+
				"Pass job_cache_id from jobs.fetch_new and a structured resume_content "+
				"(identity / summary / works / projects / educations / skills). "+
				"Returns a draft_id and an embedded PDF resource (preview-only QR; the final "+
				"QR with the recruiter access code is generated at applications.commit time). "+
				"Draft TTL = 24h, same as the job cache pool.",
		),
		mcpgo.WithString("job_cache_id", mcpgo.Required(),
			mcpgo.Description("cache_id returned by jobs.fetch_new.")),
		mcpgo.WithObject("resume_content", mcpgo.Required(),
			mcpgo.Description("Structured resume content; see resume_content schema in docs.")),
	)
}

func invokeResumeDraft(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		args, errResult := parseResumeDraftArgs(ctx, req)
		if errResult != nil {
			return errResult
		}
		drafted, err := usecases.DraftResume(
			ctx, deps.Resume, args.ownerID, args.idArg, args.content,
		)
		if err != nil {
			return resumeErrToResult(err, deps, "draft")
		}
		return draftedResumeResult(deps, &drafted)
	}
}

// resumeArgs —— resume.draft / resume.update_draft 解出来的参数集合（让
// invoke 函数把 cognitive complexity 控在 ≤7）。idArg = job_cache_id 或 draft_id，
// 由 caller 决定。
type resumeArgs struct {
	content *domain.ResumeContent
	ownerID string
	idArg   string
}

func parseResumeDraftArgs(
	ctx context.Context, req *mcpgo.CallToolRequest,
) (*resumeArgs, *mcpgo.CallToolResult) {
	return parseResumeArgs(ctx, req, "job_cache_id")
}

func parseResumeUpdateArgs(
	ctx context.Context, req *mcpgo.CallToolRequest,
) (*resumeArgs, *mcpgo.CallToolResult) {
	return parseResumeArgs(ctx, req, "draft_id")
}

func parseResumeArgs(
	ctx context.Context, req *mcpgo.CallToolRequest, idArgName string,
) (*resumeArgs, *mcpgo.CallToolResult) {
	ownerID := OwnerIDFrom(ctx)
	if ownerID == "" {
		return nil, mcpgo.NewToolResultError(errUnauthorized)
	}
	idVal, ierr := req.RequireString(idArgName)
	if ierr != nil {
		return nil, mcpgo.NewToolResultError(idArgName + " is required")
	}
	content, cerr := parseResumeContentArg(req)
	if cerr != nil {
		return nil, cerr
	}
	return &resumeArgs{ownerID: ownerID, idArg: idVal, content: content}, nil
}

// ---- resume.update_draft --------------------------------------------------

func resumeUpdateDraftTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"resume.update_draft",
		mcpgo.WithDescription(
			"Replace the structured content of an existing draft and get a fresh preview PDF. "+
				"job_snapshot is preserved (drafts snapshot the job at creation time and never "+
				"refetch).",
		),
		mcpgo.WithString("draft_id", mcpgo.Required(),
			mcpgo.Description("draft id returned by resume.draft.")),
		mcpgo.WithObject("resume_content", mcpgo.Required(),
			mcpgo.Description("New structured resume content (replaces previous).")),
	)
}

func invokeResumeUpdateDraft(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		args, errResult := parseResumeUpdateArgs(ctx, req)
		if errResult != nil {
			return errResult
		}
		drafted, err := usecases.UpdateResumeDraft(
			ctx, deps.Resume, args.ownerID, args.idArg, args.content,
		)
		if err != nil {
			return resumeErrToResult(err, deps, "update_draft")
		}
		return draftedResumeResult(deps, &drafted)
	}
}

// ---- resume.discard_draft -------------------------------------------------

func resumeDiscardDraftTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"resume.discard_draft",
		mcpgo.WithDescription(
			"Delete a draft (idempotent — unknown / wrong-owner / already-deleted all succeed).",
		),
		mcpgo.WithString("draft_id", mcpgo.Required()),
	)
}

func invokeResumeDiscardDraft(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		draftID, derr := req.RequireString("draft_id")
		if derr != nil {
			return mcpgo.NewToolResultError("draft_id is required")
		}
		if err := usecases.DiscardResumeDraft(ctx, deps.Resume, ownerID, draftID); err != nil {
			return resumeErrToResult(err, deps, "discard_draft")
		}
		return marshalResult(deps, &okResp{OK: true})
	}
}

// ---- arg parsing + result assembly ---------------------------------------

func parseResumeContentArg(
	req *mcpgo.CallToolRequest,
) (*domain.ResumeContent, *mcpgo.CallToolResult) {
	raw, ok := req.GetArguments()[resumeContentArgKey].(map[string]any)
	if !ok || raw == nil {
		return nil, mcpgo.NewToolResultError(resumeContentMissing)
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, mcpgo.NewToolResultError("resume_content not serializable")
	}
	var content domain.ResumeContent
	if uerr := json.Unmarshal(b, &content); uerr != nil {
		return nil, mcpgo.NewToolResultError("resume_content shape invalid: " + uerr.Error())
	}
	return &content, nil
}

// draftedResumeResult —— 拼 [text(json), embedded(pdf)] 多 content 结果。
func draftedResumeResult(deps *Deps, d *usecases.DraftedResume) *mcpgo.CallToolResult {
	view := resumeDraftView(&d.Draft)
	jsonBytes, err := json.Marshal(view)
	if err != nil {
		deps.Log.Error("mcp resume.draft marshal view", "err", err)
		return mcpgo.NewToolResultError(fmt.Sprintf("encode draft view: %v", err))
	}
	return &mcpgo.CallToolResult{
		Content: []mcpgo.Content{
			mcpgo.TextContent{Type: mcpgo.ContentTypeText, Text: string(jsonBytes)},
			mcpgo.NewEmbeddedResource(mcpgo.BlobResourceContents{
				URI:      previewURIScheme + d.Draft.ID,
				MIMEType: mimePDF,
				Blob:     base64.StdEncoding.EncodeToString(d.PDF),
			}),
		},
	}
}

func resumeErrToResult(err error, deps *Deps, op string) *mcpgo.CallToolResult {
	switch {
	case errors.Is(err, domain.ErrJobCacheMiss):
		return mcpgo.NewToolResultError("job cache miss (expired or never existed)")
	case errors.Is(err, domain.ErrResumeDraftNotFound):
		return mcpgo.NewToolResultError("draft not found (expired or wrong owner)")
	case errors.Is(err, domain.ErrResumeContentInvalid):
		return mcpgo.NewToolResultError("resume_content invalid: " + err.Error())
	}
	deps.Log.Error("mcp resume."+op, "err", err)
	return mcpgo.NewToolResultError(fmt.Sprintf("resume.%s failed", op))
}
