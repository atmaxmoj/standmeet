// host_inference.go — the implementation of inference.generate and report.store
// (declared in host.go).
//
// Both hold the same line: **credentials never leave the host**. When the sandbox says
// "run a pass on the owner's model," the host resolves the credential by owner+mode, runs
// it, and hands back only the result; when the sandbox says "here's the HTML I generated,"
// the host sanitises it against an allow-list before storing — that sanitising can only
// happen on the host, it's a security boundary, not formatting.

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	infcore "github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

func generateInference(resolver infcore.Resolver, usage HostUsage) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req struct {
			OwnerID  string        `json:"owner_id"`
			Mode     string        `json:"mode"`
			System   string        `json:"system"`
			Messages []sockMessage `json:"messages"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("inference.generate: decode: %w", err)
		}
		out, gerr := generateOnOwnerModel(
			ctx, resolver, &hostGen{ownerID: req.OwnerID, mode: req.Mode, usage: usage},
			&infcore.ChatRequest{System: req.System, Messages: toChatMsgs(req.Messages)},
		)
		if gerr != nil {
			return nil, gerr
		}
		res, merr := json.Marshal(map[string]string{"output": out})
		if merr != nil {
			return nil, fmt.Errorf("inference.generate: marshal: %w", merr)
		}
		return res, nil
	}
}

// generateOnOwnerModel — resolves the credential by owner+mode and runs one generation.
// **The credential lives only inside this function** — the caller gets text back, not a key.
func generateOnOwnerModel(
	ctx context.Context, resolver infcore.Resolver, g *hostGen, chat *infcore.ChatRequest,
) (string, error) {
	cred, cerr := resolver.Resolve(ctx, &infcore.ResolveInput{OwnerID: g.ownerID, Mode: g.mode})
	if cerr != nil {
		return "", fmt.Errorf("inference.generate: resolve cred: %w", cerr)
	}
	used := &infcore.UsageMeter{}
	out, gerr := infcore.Generate(infcore.WithUsageMeter(ctx, used), cred, chat)
	if gerr != nil {
		return "", fmt.Errorf("inference.generate: %w", gerr)
	}
	g.bill(ctx, cred.Model, used)
	return out, nil
}

// hostGen —— whose generation this is, on which tier, and where its bill goes.
type hostGen struct {
	usage   HostUsage
	ownerID string
	mode    string
}

// bill —— an owner-key generation is billed to the plugin that asked (the fiber the socket
// proved); a visitor's own key (byoai) is the visitor's.
func (g *hostGen) bill(ctx context.Context, model string, used *infcore.UsageMeter) {
	if g.usage == nil || g.mode == "byoai" || (used.In == 0 && used.Out == 0) {
		return
	}
	g.usage(ctx, g.ownerID, model, "block:"+hostop.CallerFiber(ctx), used)
}

func toChatMsgs(in []sockMessage) []infcore.ChatRequestMsg {
	out := make([]infcore.ChatRequestMsg, len(in))
	for i := range in {
		out[i] = infcore.ChatRequestMsg{Role: in[i].Role, Content: in[i].Content}
	}
	return out
}

func storeReport(reports usecase.ReportStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req struct {
			OwnerID        string `json:"owner_id"`
			ConversationID string `json:"conversation_id"`
			HTML           string `json:"html"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("report.store: decode: %w", err)
		}
		styled := usecase.ReportStyledDocument(usecase.SanitizeReportHTML(req.HTML))
		row, uerr := reports.Upsert(ctx, &repo.UpsertReportInput{
			OwnerID: req.OwnerID, ConversationID: req.ConversationID, HTML: styled,
		})
		if uerr != nil {
			return nil, fmt.Errorf("report.store: %w", uerr)
		}
		res, merr := json.Marshal(map[string]string{"report_id": row.ID, "html": styled})
		if merr != nil {
			return nil, fmt.Errorf("report.store: marshal: %w", merr)
		}
		return res, nil
	}
}
