// drafts.go —— GET /api/admin/drafts（列表 + 单份详情）。
//
// 从 routes.go 拆出来守 350 行上限；路由挂载仍在 Mount 里，这里只有 drafts 这一族的
// 视图形状和处理器。
//
// 两个视图都带 `resume_content`，而且是**同一个 domain 形状直通**：列表那份给卡片上的
// 缩略图，详情那份给 composer。它们以前只有详情带内容，于是卡片画的是一份写死的假简历
// （F-E-20）—— 一个面看得见真东西、另一个面看不见，两边就会各画各的。

package jobsadmin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// draftView —— 列表里的一份草稿。**带上 resume_content**：卡片上那张缩略图画的就是这一份，
// 而它以前画的是一份设计期的假简历（挂着 owner 的真名声称 Stanford 博士、Google Brain 任职，
// 两份不同的草稿画出同一张图 —— F-E-20）。内容本来就在 ListByOwner 取回的行里，这里只是
// 别再把它丢掉。
type draftView struct {
	UpdatedAt     time.Time               `json:"updated_at"`
	ID            string                  `json:"id"`
	Company       string                  `json:"company"`
	Role          string                  `json:"role"`
	ForJob        string                  `json:"for_job"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

func listDrafts(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		drafts, err := deps.Drafts.ListByOwner(r.Context(), ownerID)
		if err != nil {
			deps.Log.Error("list drafts", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeDraftsList(deps.Log, w, drafts)
	}
}

// draftDetailView —— #52: composer 打开时拿真 resume_content(+ job context)。
type draftDetailView struct {
	ID            string                  `json:"id"`
	Company       string                  `json:"company"`
	Role          string                  `json:"role"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

func getDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		draft, err := deps.Drafts.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		view := draftDetailView{
			ID: draft.ID, Company: draft.JobSnapshot.Company,
			Role: draft.JobSnapshot.Title, ResumeContent: draft.ResumeContent,
		}
		w.Header().Set(ctHeader, ctJSON)
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(view); eerr != nil {
			deps.Log.Error("encode draft detail", logErrKey, eerr)
		}
	}
}

func handleDraftDetailErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, jobsmodel.ErrResumeDraftNotFound) {
		writeJSONErr(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "draft_not_found", Message: "draft not found",
		})
		return
	}
	log.Error("get draft", logErrKey, err)
	writeServerErr(log, w)
}

func writeDraftsList(
	log *slog.Logger, w http.ResponseWriter, drafts []jobsmodel.ResumeDraft,
) {
	items := make([]draftView, 0, len(drafts))
	for i := range drafts {
		items = append(items, draftView{
			ID:            drafts[i].ID,
			Company:       drafts[i].JobSnapshot.Company,
			Role:          drafts[i].JobSnapshot.Title,
			ForJob:        drafts[i].JobCacheID,
			UpdatedAt:     drafts[i].CreatedAt,
			ResumeContent: drafts[i].ResumeContent,
		})
	}
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode drafts", logErrKey, err)
	}
}
