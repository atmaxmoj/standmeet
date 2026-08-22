// inference_models.go —— POST /api/v1/inference/models —— 访客在 BYOAI 面板里选 provider +
// 输 key + endpoint 之后调这个端点拉真实可用 model 列表（"Load models" 按钮）。
// 无 auth：调用方必须自己知道 (endpoint, key) 才能调，server 只 proxy 上游 /v1/models，
// 不持有任何风险态。
//
// **owner 那一面不走这条路**（F-R-11）：他的 key 存在库里、页面永远读不回来，所以那边是
// `providers.list_models`（组装根开封，见 cmd/server/provider_models.go）。拉列表本身两边
// 共用 `infra/providermodels`。
//
// 故意不给 default model fallback：列不出来就让 UI 提示用户自己输。Anthropic 没暴露
// /v1/models → 400 + 错误信息，UI 翻成 "this provider doesn't expose models; type manually"。

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/providermodels"
)

type listModelsRequest struct {
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
	Key      string `json:"key"`
}

type listModelsResponse struct {
	Models []string `json:"models"`
}

func (h *Handlers) listInferenceModels() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := parseListModelsReq(h, w, r)
		if !ok {
			return
		}
		models, err := providermodels.List(r.Context(), req.Provider, req.Endpoint, req.Key)
		if err != nil {
			// err 是 DisplayError（fetch 层自带回显信息）：Warn 记的是 Error()（含底层 cause，ops 看得到
			// 真实上游 HTTP body / dial 错），Classify 只把 DisplayMessage 发给浏览器。
			h.Log.Warn("list models", "provider", req.Provider, "err", err)
			writeError(h.Log, w, apierr.Classify(err, nil))
			return
		}
		writeListModels(h.Log, w, models)
	}
}

func parseListModelsReq(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (*listModelsRequest, bool) {
	var req listModelsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	if missing := missingListModelsField(&req); missing != "" {
		writeError(h.Log, w, envBadReq(missing+" required"))
		return nil, false
	}
	return &req, true
}

// missingListModelsField —— 这条路上 key 是**必须**的：它没有 auth，调用方就是钥匙的持有人。
// owner 那条路反过来（他不带 key，服务端开封库里那把），所以两条路各有各的必填项。
func missingListModelsField(req *listModelsRequest) string {
	switch {
	case req.Provider == "":
		return "provider"
	case req.Key == "":
		return "key"
	}
	return ""
}

func writeListModels(log *slog.Logger, w http.ResponseWriter, models []string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(listModelsResponse{Models: models}); err != nil {
		log.Error("encode list models", "err", err)
	}
}
