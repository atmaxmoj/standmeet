// commit.go —— POST /api/admin/drafts/{id}/commit：面板上那颗 `SEND →` 的落点。
//
// 为什么这条路存在（F-E-9）：composer 的 SEND 弹一张确认框，逐条许诺「冻结快照 /
// 渲染带 QR 的 PDF / 写 application 行 / 自动发一张 180 天的码」，而 `onSend` 接的是
// `onClose` —— 一个请求都不发，也不报错。owner 会以为自己投出去了。
//
// 打的是**同一个** usecase（`jobsuc.CommitApplication`），跟 `applications.commit` 那条路
// 共用同一份 deps：两个面因此不可能对同一次 commit 做不同的事。

package jobsadmin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

func commitDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		committed, err := jobsuc.CommitApplication(
			r.Context(), deps.Commit, ownerID, chi.URLParam(r, "id"),
		)
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		writeCommitted(deps.Log, w, &committed)
	}
}

// committedView —— **不带 PDF**：MCP 那条路把 PDF 作为 embedded resource 交给 owner 的 AI
// （它要拿去投递），而面板这条路上 owner 要知道的是「成了没有、码是多少、扫码去哪」。
//
// **订正**：这里原本写着「那份 PDF 归档在 application 行上，列表页自己能取」——**那是假的，
// 我没核实就写下了它**。`applications` 表没有 PDF 列，`jobsuc` 里也没有任何一处把渲染结果落库；
// 那些字节只在 commit 的回参里出现一次。面板上的 `DOWNLOAD PDF` 因此不是忘了接线，
// 是背后没有东西可接（F-E-13）。要让面板能下载，得先决定是存 bytes 还是按需重渲 —— 那是产品决定。
type committedView struct {
	ApplicationID string `json:"application_id"`
	AccessCode    string `json:"access_code"`
	QRURL         string `json:"qr_url"`
}

func writeCommitted(
	log *slog.Logger, w http.ResponseWriter, c *jobsmodel.CommittedApplication,
) {
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	view := committedView{
		ApplicationID: c.Application.ID, AccessCode: c.AccessCode.Code, QRURL: c.QRURL,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode committed application", logErrKey, err)
	}
}
