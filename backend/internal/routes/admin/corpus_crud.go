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

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// errInvalidJSONBody —— "invalid JSON body" 字面在本文件多次出现，提常量。
const errInvalidJSONBody = "invalid JSON body"

// timeRFC3339 —— admin list / mutation 响应统一用 RFC3339，跟 list endpoint 对齐。
// 转换器 rawItemFromDomain / wikiItemFromDomain / outputItemFromDomain 在
// corpus_views.go。
const timeRFC3339 = "2006-01-02T15:04:05Z07:00"

// MountCorpusCRUD 挂统一的 corpus 详情 / 改 / 删 / promote 路由：genre 作路径参数
// （合并了原 /raw|/wiki|/output|/subjectivity 各自的 {id} 路由）。create 归 MountCorpus
// 的 POST /corpus/{genre}。caller 已包 /api/admin。
func (h *Handlers) MountCorpusCRUD(r chi.Router) {
	r.Get("/corpus/{genre}/{id}", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.getRaw(), "wiki": h.getWiki(), "output": h.getOutput(),
	}))
	r.Patch("/corpus/{genre}/{id}", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.updateRaw(), "wiki": h.updateWiki(), "output": h.updateOutput(),
	}))
	r.Delete("/corpus/{genre}/{id}", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.archiveRaw(), "wiki": h.deleteWiki(),
		"output": h.deleteOutput(), "subjectivity": h.deleteSubjectivity(),
	}))
	r.Post("/corpus/{genre}/{id}/promote", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.promoteRaw(), "wiki": h.promoteWiki(),
	}))
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
		raw, err := corpus.UpdateRaw(r.Context(), h.Corpus.Corpus, &corpus.UpdateRawReq{
			OwnerID: middleware.OwnerIDFrom(r.Context()), ID: chi.URLParam(r, "id"),
			Body: body.Body, Tags: body.Tags, FlaggedPrivate: body.FlaggedPrivate,
		})
		writeCorpusResult(h.Log, w, rawItemFromDomain(&raw), err, "update raw")
	}
}

func (h *Handlers) archiveRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := corpus.ArchiveRaw(
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
		wiki, err := corpus.PromoteToWiki(r.Context(), h.Corpus.Corpus, &corpus.PromoteInput{
			OwnerID:  middleware.OwnerIDFrom(r.Context()),
			RawID:    chi.URLParam(r, "id"),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title,
			Tags:     body.Tags,
		})
		writeCorpusResult(h.Log, w, wikiItemFromDomain(&wiki, ""), err, "promote raw")
	}
}

// ─── wiki ───────────────────────────────────────────────────

type wikiWriteBody struct {
	ParentID     string   `json:"parent_id"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Tags         []string `json:"tags"`
	CSSClasses   []string `json:"css_classes"`
	ShowAsSource bool     `json:"show_as_source"`
}

func (h *Handlers) createWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body wikiWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		wiki, err := corpus.CreateWiki(r.Context(), h.Corpus.Corpus, &corpus.CreateWikiReq{
			OwnerID:  middleware.OwnerIDFrom(r.Context()),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags,
		})
		writeCorpusResult(h.Log, w, wikiItemFromDomain(&wiki, ""), err, "create wiki")
	}
}

func (h *Handlers) updateWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body wikiWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		wiki, err := corpus.UpdateWiki(r.Context(), h.Corpus.Corpus, &corpus.UpdateWikiReq{
			OwnerID: middleware.OwnerIDFrom(r.Context()), ID: chi.URLParam(r, "id"),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags, ShowAsSource: body.ShowAsSource, CSSClasses: body.CSSClasses,
		})
		writeCorpusResult(h.Log, w, wikiItemFromDomain(&wiki, ""), err, "update wiki")
	}
}

func (h *Handlers) deleteWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := corpus.DeleteWiki(
			r.Context(), h.Corpus.Corpus,
			middleware.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		)
		writeCorpusDelete(h.Log, w, err, "delete wiki")
	}
}

func (h *Handlers) deleteSubjectivity() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := corpus.DeleteSubjectivity(
			r.Context(), h.Corpus.Corpus,
			middleware.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		)
		writeCorpusDelete(h.Log, w, err, "delete subjectivity")
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
		out, err := corpus.PromoteWikiToOutput(
			r.Context(), h.Corpus.Corpus, &corpus.PromoteToOutputInput{
				OwnerID:  middleware.OwnerIDFrom(r.Context()),
				WikiID:   chi.URLParam(r, "id"),
				ParentID: optionalString(body.ParentID),
				Title:    body.Title,
				Tags:     body.Tags,
			},
		)
		writeCorpusResult(h.Log, w, outputItemFromDomain(&out, ""), err, "promote wiki")
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
		out, err := corpus.CreateOutput(r.Context(), h.Corpus.Corpus, &corpus.CreateOutputReq{
			OwnerID:  middleware.OwnerIDFrom(r.Context()),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags,
		})
		writeCorpusResult(h.Log, w, outputItemFromDomain(&out, ""), err, "create output")
	}
}

func (h *Handlers) updateOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body outputWriteBody
		if err := decodeBody(r, &body); err != nil {
			writeError(h.Log, w, envBadReq(errInvalidJSONBody))
			return
		}
		out, err := corpus.UpdateOutput(r.Context(), h.Corpus.Corpus, &corpus.UpdateOutputReq{
			OwnerID: middleware.OwnerIDFrom(r.Context()), ID: chi.URLParam(r, "id"),
			ParentID: optionalString(body.ParentID),
			Title:    body.Title, Body: body.Body,
			Tags: body.Tags, ShowAsSource: body.ShowAsSource,
		})
		writeCorpusResult(h.Log, w, outputItemFromDomain(&out, ""), err, "update output")
	}
}

func (h *Handlers) deleteOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := corpus.DeleteOutput(
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
// 泛型 T 让 caller 传具体类型（corpus.Raw / WikiEntry / OutputEntry）；
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
	{Match: apierr.ErrEmptyField, Envelope: envBadReq("required field is empty")},
	{Match: corpus.ErrParentNotFound, Envelope: envBadReq("parent entry not found")},
	{Match: corpus.ErrParentCycle, Envelope: envBadReq("parent would create a cycle")},
	{
		Match: corpus.ErrSiblingSlugTaken, Envelope: apierr.Envelope{
			Status:  http.StatusConflict,
			Code:    "sibling_name_taken",
			Message: "an entry with the same name already exists here",
		},
	},
	{
		Match: corpus.ErrRawNotFound, Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "raw_not_found", Message: "raw entry not found",
		},
	},
	{
		Match: corpus.ErrWikiNotFound, Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "wiki_not_found", Message: "wiki entry not found",
		},
	},
	{
		Match: corpus.ErrOutputNotFound, Envelope: apierr.Envelope{
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
	} else if !errors.Is(err, apierr.ErrEmptyField) {
		log.Warn(tag, "err", err)
	}
	writeError(log, w, env)
}
