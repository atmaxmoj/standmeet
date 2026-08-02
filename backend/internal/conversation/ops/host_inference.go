// host_inference.go —— inference.generate 与 report.store 的实现(声明在 host.go)。
//
// 两件都守着同一条线:**凭据不出宿主**。沙箱说"用 owner 的模型跑一段",宿主按 owner+mode
// 解出凭据、跑完、只把结果递回去;沙箱说"这是我生成的 HTML",宿主按白名单洗一遍再存 ——
// 洗这件事只能在宿主做,那是安全边界,不是格式化。

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

func generateInference(resolver infcore.Resolver) hostop.Invoke {
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
			ctx, resolver, req.OwnerID, req.Mode,
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

// generateOnOwnerModel —— 按 owner+mode 解出凭据、跑一次生成。**凭据只活在这个函数里**:
// 上面那层拿到的是文本,不是 key。
func generateOnOwnerModel(
	ctx context.Context, resolver infcore.Resolver,
	ownerID, mode string, chat *infcore.ChatRequest,
) (string, error) {
	cred, cerr := resolver.Resolve(ctx, &infcore.ResolveInput{OwnerID: ownerID, Mode: mode})
	if cerr != nil {
		return "", fmt.Errorf("inference.generate: resolve cred: %w", cerr)
	}
	out, gerr := infcore.Generate(ctx, cred, chat)
	if gerr != nil {
		return "", fmt.Errorf("inference.generate: %w", gerr)
	}
	return out, nil
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
