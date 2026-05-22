// applications_tools.go —— MCP tools 的 applications.* group。
//
// v1 只暴露 commit —— Phase 4 之前 listing / status 走 admin REST 即可。
// 返回 [text(json), embedded(pdf)] 多 content 结构（同 resume.draft）：JSON
// 文本携带 application_id / access_code plaintext / QR URL；PDF 走 base64 blob。
//
// 关键设计：commit 内部已经把 issue_access_code + write application + delete
// draft 三步打包在单事务里（见 postgres.ApplicationRepo.Commit），usecase 这
// 层只负责拼 QR URL + 渲染 final PDF。

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

const applicationURIScheme = "standmeet://application/" // suffix = application id

func applicationsTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(applicationsCommitTool(), wrapTool(invokeApplicationsCommit(deps)))
}

func applicationsCommitTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"applications.commit",
		mcpgo.WithDescription(
			"Promote a resume draft to a persistent application: atomically issues "+
				"a 180-day AccessCode (10 sessions / 50 turns per member), writes the "+
				"application row, and deletes the draft. Returns application_id, the "+
				"plaintext access_code, the QR URL printed on the resume, and the final "+
				"PDF (base64) ready for Playwright submission.",
		),
		mcpgo.WithString("draft_id", mcpgo.Required(),
			mcpgo.Description("draft id returned by resume.draft.")),
	)
}

func invokeApplicationsCommit(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError(errUnauthorized)
		}
		draftID, derr := req.RequireString("draft_id")
		if derr != nil {
			return mcpgo.NewToolResultError("draft_id is required")
		}
		committed, err := usecases.CommitApplication(ctx, deps.Applications, ownerID, draftID)
		if err != nil {
			return applicationsErrToResult(err, deps, "commit")
		}
		return committedApplicationResult(deps, &committed)
	}
}

// committedApplicationResult —— [text(json view), embedded(final pdf)]。
func committedApplicationResult(
	deps *Deps, c *domain.CommittedApplication,
) *mcpgo.CallToolResult {
	view := committedApplicationView(c)
	jsonBytes, err := json.Marshal(view)
	if err != nil {
		deps.Log.Error("mcp applications.commit marshal view", "err", err)
		return mcpgo.NewToolResultError(fmt.Sprintf("encode view: %v", err))
	}
	return &mcpgo.CallToolResult{
		Content: []mcpgo.Content{
			mcpgo.TextContent{Type: mcpgo.ContentTypeText, Text: string(jsonBytes)},
			mcpgo.NewEmbeddedResource(mcpgo.BlobResourceContents{
				URI:      applicationURIScheme + c.Application.ID,
				MIMEType: mimePDF,
				Blob:     base64.StdEncoding.EncodeToString(c.PDF),
			}),
		},
	}
}

func applicationsErrToResult(err error, deps *Deps, op string) *mcpgo.CallToolResult {
	switch {
	case errors.Is(err, domain.ErrResumeDraftNotFound):
		return mcpgo.NewToolResultError("draft not found (expired or wrong owner)")
	case errors.Is(err, domain.ErrApplicationNotFound):
		return mcpgo.NewToolResultError("application not found")
	case errors.Is(err, domain.ErrOwnerNotFound):
		return mcpgo.NewToolResultError("owner not found")
	}
	deps.Log.Error("mcp applications."+op, "err", err)
	return mcpgo.NewToolResultError(fmt.Sprintf("applications.%s failed", op))
}
