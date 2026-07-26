// Package report —— socket controller。report.store host op —— report.store host op：断网沙箱 cap 把生成的原始 HTML 交给 host,
// host 做 allow-list sanitize(安全关键,只在 host 做)+ styled-render + 落 report 行,回 report_id +
// styled 文档。按业务分类:它跟 report artifact 的渲染(report_document/report_sanitize)住一起。

package report

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// RegisterReportStoreOp —— 把 "report.store" 挂到 srv:{owner_id,conversation_id,html} →
// SanitizeReportHTML → ReportStyledDocument → Upsert → {report_id, html:styled}。
func RegisterReportStoreOp(srv *capsocket.Server, reports usecases.ReportStore) {
	srv.Handle("report.store", func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		var req struct {
			OwnerID        string `json:"owner_id"`
			ConversationID string `json:"conversation_id"`
			HTML           string `json:"html"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("report.store: decode: %w", err)
		}
		styled := usecases.ReportStyledDocument(usecases.SanitizeReportHTML(req.HTML))
		row, uerr := reports.Upsert(ctx, &postgres.UpsertReportInput{
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
	})
}
