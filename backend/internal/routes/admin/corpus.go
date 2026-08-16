// corpus.go —— admin 的语料面:列表 / 详情 / 建 / 改 / 删 / 提升,genre 走路径参数。
//
// 能力全部经出站收口取(声明在 internal/corpus/ops);这一层只留 REST 形状:genre 在路径、
// id 在路径、其余在 body,以及成功回 200 还是 201 还是 204。
//
// 树视图和分页视图(/tree、/page)是**面板独有**的浏览形态,不经收口:它们回的是树节点,
// 不是"一条语料"。

package admin

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CorpusDeps —— admin corpus handlers 的依赖。
//
// Face —— 语料的能力经收口取。Corpus 只剩树/分页那两个面板独有的视图还在直连。
type CorpusDeps struct {
	Corpus corpus.Deps
	Face   *dispatcher.Face
}

const (
	defaultCorpusLimit = 50
	maxCorpusLimit     = 200
	paramGenre         = "genre"
	paramEntryID       = "id"
	paramAssetID       = "asset_id"
)

// MountCorpus 挂 corpus 的列表 + 新建:genre 作路径参数(合并了原 /raw · /wiki · /output
// 三套 URL —— genre 本来就是参数,不该拆成不同 endpoint)。
func (h *Handlers) MountCorpus(r chi.Router) {
	face := h.Corpus.Face
	r.Get("/corpus/{genre}", h.dispatchOp(face, "corpus.list", corpusListArgs, jsonOK))
	r.Post("/corpus/{genre}", h.dispatchOp(face, "corpus.create", corpusBodyArgs, jsonCreated))
	// search —— 按内容找一条。列表只给最新的一页,而 owner 的语料是上千条:
	// 「打开我那条 good-regulator-theorem」以前在这个面上做不到(F-L-39)。
	r.Get("/corpus/{genre}/search", h.dispatchOp(face, "corpus.search", corpusSearchArgs, jsonOK))
	r.Get("/corpus/{genre}/tree", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.treeRaw(), "wiki": h.treeWiki(), "output": h.treeOutput(),
		"subjectivity": h.treeSubjectivity(),
	}))
	r.Get("/corpus/{genre}/page", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.pageRaw(), "wiki": h.pageWiki(), "output": h.pageOutput(),
	}))
	// tags —— 这个 genre 用过的全部标签(语料级)。面板的标签行读它。
	r.Get("/corpus/{genre}/tags", h.byGenre(map[string]http.HandlerFunc{
		"wiki": h.tagsWiki(),
	}))
	// check-i18n —— 只看不写(POST 是因为正文进 body,不是因为它改了什么)。
	// 面板的编辑器在保存之前问一次,拿到的诊断跟 MCP 写入口拒绝时用的是同一份。
	r.Post("/corpus/check-i18n", h.dispatchOp(face, "corpus.check_i18n", bodyArgs, jsonOK))
}

// byGenre —— 树/分页那两条还在用的 genre 分派:URL 的 {genre} 选对应 handler。
// 未知 / 该视图不支持的 genre → 404 unknown_genre。
func (h *Handlers) byGenre(m map[string]http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if handler, ok := m[chi.URLParam(r, paramGenre)]; ok {
			handler(w, r)
			return
		}
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "unknown_genre", Message: "unknown corpus genre",
		})
	}
}

// corpusListArgs —— genre 在路径,limit 在 query。收口那边只认一份扁平 args。
//
// limit 解不动就整个略过,由域取默认值 —— ?limit=abc 不是错误,是"没说"。
func corpusListArgs(r *http.Request) (json.RawMessage, error) {
	fields := map[string]json.RawMessage{
		paramGenre: quoteJSON(chi.URLParam(r, paramGenre)),
	}
	addPositiveInts(fields, r.URL.Query(), "limit")
	return marshalArgs(fields)
}

// corpusSearchArgs —— genre 在路径,查询词和翻页在 query。`?q=` 空 = 域那边报缺参数,
// 不在这里编一个空搜索:一次没给词的搜索和一次搜不到的搜索,不该长成同一个回答。
func corpusSearchArgs(r *http.Request) (json.RawMessage, error) {
	fields := map[string]json.RawMessage{
		paramGenre: quoteJSON(chi.URLParam(r, paramGenre)),
		"query":    quoteJSON(r.URL.Query().Get("q")),
	}
	addPositiveInts(fields, r.URL.Query(), "limit", "offset")
	return marshalArgs(fields)
}

// addPositiveInts —— query 上那几个可选的正整数,有就带上。
//
// 抽出来是因为 `check-routes-cyclo` 说的那句话是对的:**分支意味着业务,face 只该声明和调用**。
// 「?limit=abc 不是错误,是没说」这条判断原先在两条路由里各抄了一遍 —— 抄第二遍的时候
// 就该抽了。
func addPositiveInts(fields map[string]json.RawMessage, q url.Values, names ...string) {
	for _, n := range names {
		if raw, ok := positiveInt(q, n); ok {
			fields[n] = raw
		}
	}
}

func positiveInt(q url.Values, name string) (json.RawMessage, bool) {
	v, err := strconv.Atoi(q.Get(name))
	if err != nil {
		return nil, false
	}
	if v <= 0 {
		return nil, false
	}
	return json.RawMessage(strconv.Itoa(v)), true
}

// corpusBodyArgs —— body 里的字段 + 路径上的 genre。
func corpusBodyArgs(r *http.Request) (json.RawMessage, error) {
	fields, err := decodeBodyFields(r)
	if err != nil {
		return nil, err
	}
	fields[paramGenre] = quoteJSON(chi.URLParam(r, paramGenre))
	return marshalArgs(fields)
}

// corpusEntryArgs —— body + 路径上的 genre 和 id(改)。
func corpusEntryArgs(r *http.Request) (json.RawMessage, error) {
	fields, err := decodeBodyFields(r)
	if err != nil {
		return nil, err
	}
	fields[paramGenre] = quoteJSON(chi.URLParam(r, paramGenre))
	fields[paramEntryID] = quoteJSON(chi.URLParam(r, paramEntryID))
	return marshalArgs(fields)
}

// corpusAssetArgs —— 路径上的 genre + 条目 id + 素材 id(删一份素材)。
func corpusAssetArgs(r *http.Request) (json.RawMessage, error) {
	return marshalArgs(map[string]json.RawMessage{
		paramGenre:   quoteJSON(chi.URLParam(r, paramGenre)),
		paramEntryID: quoteJSON(chi.URLParam(r, paramEntryID)),
		paramAssetID: quoteJSON(chi.URLParam(r, paramAssetID)),
	})
}

// corpusIDArgs —— 只要路径上的 genre 和 id(读 / 删)。
func corpusIDArgs(r *http.Request) (json.RawMessage, error) {
	return marshalArgs(map[string]json.RawMessage{
		paramGenre:   quoteJSON(chi.URLParam(r, paramGenre)),
		paramEntryID: quoteJSON(chi.URLParam(r, paramEntryID)),
	})
}

func marshalArgs(fields map[string]json.RawMessage) (json.RawMessage, error) {
	out, err := json.Marshal(fields)
	if err != nil {
		return nil, dispatcher.BadInput("invalid request")
	}
	return out, nil
}

func quoteJSON(s string) json.RawMessage {
	out, err := json.Marshal(s)
	if err != nil {
		return json.RawMessage(`""`)
	}
	return out
}
