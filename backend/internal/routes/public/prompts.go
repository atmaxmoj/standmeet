// prompts.go —— GET /api/v1/prompts/{id} —— 单一源 prompt fragment 读取。
//
// Phase D-1: prompts/ 抽到 backend/internal/prompts embed.FS；此 endpoint 让
// 前端 (visitor chat agent loop) 不再依赖 backend 装配，自己 fetch fragment
// 渲入 system prompt。id 支持子路径 (e.g. "capabilities/corpus.retrieval")，
// chi 用通配 wildcard `*` 捕获。返 text/plain；ErrPromptNotFound → 404。

package public

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/prompts"
)

// PromptsHandlers —— prompts route 依赖。当前无 runtime 依赖（prompts 走
// 包级 embed.FS），保留 struct 是为了跟其他 public handler 形态一致 +
// 留 Log 注入口。
type PromptsHandlers struct {
	Log *slog.Logger
}

// Mount 挂 GET /prompts/*。caller 负责前缀。
func (h *PromptsHandlers) Mount(r chi.Router) {
	r.Get("/prompts/*", h.get())
}

func (h *PromptsHandlers) get() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "*")
		body, ok := loadPromptOrWriteErr(h.Log, w, id)
		if !ok {
			return
		}
		writePromptBody(h.Log, w, id, body)
	}
}

// loadPromptOrWriteErr —— 尝试加载 prompt；失败时写好响应并返 (_, false)。
// 把错误分流挪出 handler 让 cyclo ≤ 3。
func loadPromptOrWriteErr(
	log *slog.Logger, w http.ResponseWriter, id string,
) (string, bool) {
	body, err := prompts.Load(id)
	if err == nil {
		return body, true
	}
	if errors.Is(err, prompts.ErrPromptNotFound) {
		http.Error(w, "prompt not found", http.StatusNotFound)
		return "", false
	}
	log.Error("prompts load", "id", id, "err", err)
	http.Error(w, "internal error", http.StatusInternalServerError)
	return "", false
}

func writePromptBody(log *slog.Logger, w http.ResponseWriter, id, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write([]byte(body)); werr != nil {
		log.Error("prompts write", "id", id, "err", werr)
	}
}
