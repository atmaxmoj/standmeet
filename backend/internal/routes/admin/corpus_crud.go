// corpus_crud.go —— raw / wiki / output 三层 admin CRUD endpoints。
// 从 corpus.go (list / createRaw) 拆出来守 350 行 max-lines。
//
// 路由表:
//   PATCH  /raw/{id}                 —— UpdateRaw（body + tags + private）
//   DELETE /raw/{id}                 —— ArchiveRaw（soft）
//   POST   /raw/{id}/promote         —— promote to wiki
//   POST   /wiki                     —— CreateWiki（不 promote 起新条）
//   PATCH  /wiki/{id}                —— UpdateWiki
//   DELETE /wiki/{id}                —— DeleteWiki（硬）
//   POST   /wiki/{id}/promote        —— promote to output
//   POST   /output                   —— CreateOutput
//   PATCH  /output/{id}              —— UpdateOutput
//   DELETE /output/{id}              —— DeleteOutput

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// errInvalidJSONBody —— "invalid JSON body" 字面在本文件多次出现，提常量。
const errInvalidJSONBody = "invalid JSON body"

// timeRFC3339 —— admin list / mutation 响应统一用 RFC3339，跟 list endpoint 对齐。
// 转换器 rawItemFromDomain / wikiItemFromDomain / outputItemFromDomain 在
// corpus_views.go。
const timeRFC3339 = "2006-01-02T15:04:05Z07:00"

// MountCorpusCRUD 挂三层 CRUD 路由（caller 已包 /api/admin）。
func (h *Handlers) MountCorpusCRUD(r chi.Router) {
	r.Get("/raw/{id}", h.getRaw())
	r.Patch("/raw/{id}", h.updateRaw())
	r.Delete("/raw/{id}", h.archiveRaw())
	r.Post("/raw/{id}/promote", h.promoteRaw())

	r.Post("/wiki", h.createWiki())
	r.Get("/wiki/{id}", h.getWiki())
	r.Patch("/wiki/{id}", h.updateWiki())
	r.Delete("/wiki/{id}", h.deleteWiki())
	r.Post("/wiki/{id}/promote", h.promoteWiki())

	r.Post("/output", h.createOutput())
	r.Get("/output/{id}", h.getOutput())
	r.Patch("/output/{id}", h.updateOutput())
	r.Delete("/output/{id}", h.deleteOutput())
}

// ─── raw ────────────────────────────────────────────────────

type updateRawBody struct {
	Body           string   `json:"body"`
	Tags           []string `json:"tags"`
	FlaggedPrivate bool     `json:"flagged_private"`
}

func (h *Handlers) updateRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body updateRawBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		raw, err := usecases.UpdateRaw(r.Context(), h.Corpus.Corpus, &usecases.UpdateRawInput{
			OwnerID: middleware.OwnerIDFrom(r.Context()), ID: chi.URLParam(r, "id"),
			Body: body.Body, Tags: body.Tags, FlaggedPrivate: body.FlaggedPrivate,
		})
		writeCorpusResult(h.Log, w, rawItemFromDomain(&raw), err, "update raw")
	}
}

func (h *Handlers) archiveRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := usecases.ArchiveRaw(
			r.Context(), h.Corpus.Corpus,
			middleware.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		)
		writeCorpusDelete(h.Log, w, err, "archive raw")
	}
}

type promoteRawBody struct {
	ParentID string   `json:"parent_id"`
	Title    string   `json:"title"`
	Tags     []string `json:"tags"`
}

func (h *Handlers) promoteRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body promoteRawBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		wiki, err := usecases.PromoteToWiki(r.Context(), h.Corpus.Corpus, &usecases.PromoteInput{
			OwnerID:  middleware.OwnerIDFrom(r.Context()),
			RawID:    chi.URLParam(r, "id"),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title,
			Tags:     body.Tags,
		})
		writeCorpusResult(h.Log, w, wikiItemFromDomain(&wiki), err, "promote raw")
	}
}

// ─── wiki ───────────────────────────────────────────────────

type wikiWriteBody struct {
	ParentID     string   `json:"parent_id"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Tags         []string `json:"tags"`
	ShowAsSource bool     `json:"show_as_source"`
}

func (h *Handlers) createWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body wikiWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		wiki, err := usecases.CreateWiki(r.Context(), h.Corpus.Corpus, &usecases.CreateWikiInput{
			OwnerID:  middleware.OwnerIDFrom(r.Context()),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags,
		})
		writeCorpusResult(h.Log, w, wikiItemFromDomain(&wiki), err, "create wiki")
	}
}

func (h *Handlers) updateWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body wikiWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		wiki, err := usecases.UpdateWiki(r.Context(), h.Corpus.Corpus, &usecases.UpdateWikiInput{
			OwnerID: middleware.OwnerIDFrom(r.Context()), ID: chi.URLParam(r, "id"),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags, ShowAsSource: body.ShowAsSource,
		})
		writeCorpusResult(h.Log, w, wikiItemFromDomain(&wiki), err, "update wiki")
	}
}

func (h *Handlers) deleteWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := usecases.DeleteWiki(
			r.Context(), h.Corpus.Corpus,
			middleware.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		)
		writeCorpusDelete(h.Log, w, err, "delete wiki")
	}
}

type promoteWikiBody struct {
	ParentID string   `json:"parent_id"`
	Title    string   `json:"title"`
	Tags     []string `json:"tags"`
}

func (h *Handlers) promoteWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body promoteWikiBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		out, err := usecases.PromoteWikiToOutput(
			r.Context(), h.Corpus.Corpus, &usecases.PromoteToOutputInput{
				OwnerID:  middleware.OwnerIDFrom(r.Context()),
				WikiID:   chi.URLParam(r, "id"),
				ParentID: optionalString(body.ParentID),
				Title:    body.Title,
				Tags:     body.Tags,
			})
		writeCorpusResult(h.Log, w, outputItemFromDomain(&out), err, "promote wiki")
	}
}

// ─── output ─────────────────────────────────────────────────

type outputWriteBody struct {
	ParentID     string   `json:"parent_id"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Tags         []string `json:"tags"`
	ShowAsSource bool     `json:"show_as_source"`
}

func (h *Handlers) createOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body outputWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		out, err := usecases.CreateOutput(r.Context(), h.Corpus.Corpus, &usecases.CreateOutputInput{
			OwnerID:  middleware.OwnerIDFrom(r.Context()),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags,
		})
		writeCorpusResult(h.Log, w, outputItemFromDomain(&out), err, "create output")
	}
}

func (h *Handlers) updateOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body outputWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		out, err := usecases.UpdateOutput(r.Context(), h.Corpus.Corpus, &usecases.UpdateOutputInput{
			OwnerID: middleware.OwnerIDFrom(r.Context()), ID: chi.URLParam(r, "id"),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags, ShowAsSource: body.ShowAsSource,
		})
		writeCorpusResult(h.Log, w, outputItemFromDomain(&out), err, "update output")
	}
}

func (h *Handlers) deleteOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := usecases.DeleteOutput(
			r.Context(), h.Corpus.Corpus,
			middleware.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		)
		writeCorpusDelete(h.Log, w, err, "delete output")
	}
}

// ─── shared helpers ─────────────────────────────────────────

// decodeBody —— 收口 json decode；caller 传具体 struct 的 pointer。
// `any` 是 json.NewDecoder.Decode 的真实签名，这里只透传，不是 "business" 用法。
//
//nolint:forbidigo // shim to json.Decode; payload type stays in handler.
func decodeBody(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// writeCorpusResult —— JSON 200 if err == nil, else 翻 sentinel → envelope。
// 泛型 T 让 caller 传具体类型（domain.RawEntry / WikiEntry / OutputEntry）；
// `any` 约束是 Go 标准库 json.Encode 已经接受的形态，不是 "business any"。
//
//nolint:forbidigo // generic constraint forwarded to encoding/json.
func writeCorpusResult[T any](
	log *slog.Logger, w http.ResponseWriter, payload T, err error, tag string,
) {
	if err != nil {
		writeCorpusErr(log, w, err, tag)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if encErr := json.NewEncoder(w).Encode(payload); encErr != nil {
		log.Error("encode "+tag, "err", encErr)
	}
}

// writeCorpusDelete —— 删除路径成功返 204。
func writeCorpusDelete(log *slog.Logger, w http.ResponseWriter, err error, tag string) {
	if err != nil {
		writeCorpusErr(log, w, err, tag)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var corpusErrCases = []apierr.Case{
	{Match: usecases.ErrEmptyField, Envelope: envBadReq("required field is empty")},
	{
		Match: domain.ErrRawNotFound, Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "raw_not_found", Message: "raw entry not found",
		},
	},
	{
		Match: domain.ErrWikiNotFound, Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "wiki_not_found", Message: "wiki entry not found",
		},
	},
	{
		Match: domain.ErrOutputNotFound, Envelope: apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "output_not_found",
			Message: "output entry not found",
		},
	},
}

func writeCorpusErr(log *slog.Logger, w http.ResponseWriter, err error, tag string) {
	env := apierr.Classify(err, corpusErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error(tag, "err", err)
	} else if !errors.Is(err, usecases.ErrEmptyField) {
		log.Warn(tag, "err", err)
	}
	writeError(log, w, env)
}
