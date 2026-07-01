// inference_models.go —— POST /api/v1/inference/models —— UI 选 provider +
// 输 key + endpoint 后调这个端点拉真实可用 model 列表（"Load models"
// button）。无 auth：调用方必须知道 (endpoint, key) 才能调，server 只
// proxy 上游 /v1/models，不持有任何风险态。
//
// 故意不给 default model fallback：列不出来就让 UI 提示用户自己输（preset
// 表里也没 default model 字段了）。Anthropic 没暴露 /v1/models → 400
// + 错误信息，UI 翻成 "this provider doesn't expose models; type
// manually"。

package public

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/apierr"
)

const (
	listModelsTimeout    = 15 * time.Second
	listModelsMaxBodyMiB = 1
)

type listModelsRequest struct {
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
	Key      string `json:"key"`
}

type listModelsResponse struct {
	Models []string `json:"models"`
}

// errProviderNoModelList —— Anthropic / 类似没暴露 /v1/models 的 provider
// 返这个；UI 翻成 "type model manually" 提示。
var errProviderNoModelList = errors.New(
	"provider does not expose a model list; type model id manually",
)

func (h *Handlers) listInferenceModels() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := parseListModelsReq(h, w, r)
		if !ok {
			return
		}
		models, err := fetchModelsFromProvider(r.Context(), req)
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

func missingListModelsField(req *listModelsRequest) string {
	switch {
	case req.Provider == "":
		return "provider"
	case req.Key == "":
		return "key"
	}
	return ""
}

// fetchModelsFromProvider —— 返 DisplayError：每个失败都自带「给用户看的人话 + 机器码 + 400」，
// upstream 网络/HTTP 错用 DisplayWrap 裹住原始 cause（进日志，不进客户端）。
func fetchModelsFromProvider(
	ctx context.Context, req *listModelsRequest,
) ([]string, error) {
	if req.Provider == "anthropic" {
		// Anthropic 不暴露 /v1/models → UI 据此提示手输 model。
		return nil, apierr.Display(
			http.StatusBadRequest, "no_model_list", errProviderNoModelList.Error())
	}
	if req.Endpoint == "" {
		return nil, apierr.Display(http.StatusBadRequest, "endpoint_required",
			"This provider needs an endpoint URL.")
	}
	return openAIModelsOrDisplay(ctx, req.Endpoint, req.Key)
}

// openAIModelsOrDisplay —— 拉 openai-style /v1/models；网络/HTTP/解码错裹成可回显的 provider-unreachable
// （原始 cause 进日志，客户端只见人话）。拆出来让 fetchModelsFromProvider cyclo ≤3。
func openAIModelsOrDisplay(ctx context.Context, baseURL, key string) ([]string, error) {
	models, err := getOpenAIModels(ctx, baseURL, key)
	if err != nil {
		return nil, apierr.DisplayWrap(http.StatusBadRequest, "provider_unreachable",
			"Couldn't reach the model provider — check the base URL and key.", err)
	}
	return models, nil
}

type oaModelListItem struct {
	ID string `json:"id"`
}

type oaModelList struct {
	Data []oaModelListItem `json:"data"`
}

func getOpenAIModels(ctx context.Context, baseURL, key string) ([]string, error) {
	resp, err := callUpstreamModelsAPI(ctx, baseURL, key)
	if err != nil {
		return nil, err
	}
	defer closeRespBody(resp)
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, readUpstreamErr(resp)
	}
	return parseOpenAIModelList(resp.Body)
}

func closeRespBody(resp *http.Response) {
	if cerr := resp.Body.Close(); cerr != nil {
		_ = cerr
	}
}

func callUpstreamModelsAPI(
	ctx context.Context, baseURL, key string,
) (*http.Response, error) {
	httpReq, herr := buildModelsHTTPRequest(ctx, baseURL, key)
	if herr != nil {
		return nil, herr
	}
	client := &http.Client{Timeout: listModelsTimeout}
	resp, derr := client.Do(httpReq)
	if derr != nil {
		return nil, fmt.Errorf("upstream: %w", derr)
	}
	return resp, nil
}

func buildModelsHTTPRequest(
	ctx context.Context, baseURL, key string,
) (*http.Request, error) {
	url := strings.TrimRight(baseURL, "/") + "/v1/models"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func readUpstreamErr(resp *http.Response) error {
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, listModelsMaxBodyMiB<<20))
	if rerr != nil {
		body = []byte("(read body err)")
	}
	return fmt.Errorf("upstream %d: %s", resp.StatusCode, string(body))
}

func parseOpenAIModelList(body io.Reader) ([]string, error) {
	var list oaModelList
	if err := json.NewDecoder(body).Decode(&list); err != nil {
		return nil, fmt.Errorf("decode upstream: %w", err)
	}
	return modelIDsFromList(&list), nil
}

func modelIDsFromList(list *oaModelList) []string {
	out := make([]string, 0, len(list.Data))
	for i := range list.Data {
		if list.Data[i].ID != "" {
			out = append(out, list.Data[i].ID)
		}
	}
	return out
}

func writeListModels(log *slog.Logger, w http.ResponseWriter, models []string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(listModelsResponse{Models: models}); err != nil {
		log.Error("encode list models", "err", err)
	}
}
