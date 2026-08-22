// Package providermodels —— 问一个 OpenAI 式的推理端点：你有哪些模型。
//
// **为什么它不住在路由层了**（F-R-11）：这件事有**两个调用方**，而它们拿 key 的方式完全不同 ——
//
//   - 访客那一面（`/api/v1/inference/models`，无 auth）：key 是调用方在 BYOAI 面板里现输的，
//     跟着请求进来。
//   - owner 那一面：key **早就存在库里**（加密），页面永远读不回来。owner 打开自己配好的
//     provider 点 "load models"，客户端手上根本没有那串字符 —— 以前它照发一个空 key，
//     后端 `key required` 400，屏幕上什么都没有。
//
// 两边差的只有「key 从哪来」，拉列表这件事一模一样，所以它搬到这里：域外、无状态、
// 谁拿到 (endpoint, key) 谁都能调。owner 那条路上的开封仍然只发生在组装根
// （`cmd/server/provider_models.go`）—— 域这一层从不解封。
package providermodels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	listTimeout    = 15 * time.Second
	listMaxBodyMiB = 1
)

// ErrNoModelList —— Anthropic 之类不暴露 /v1/models 的 provider。UI 据此提示手输 model。
var ErrNoModelList = errors.New(
	"provider does not expose a model list; type model id manually",
)

// List —— 拉这个 provider 的可用模型。返 DisplayError：每个失败自带「给用户看的人话 +
// 机器码 + 400」，原始 cause 裹在里面（进日志，不进客户端）。
func List(ctx context.Context, provider, endpoint, key string) ([]string, error) {
	if provider == "anthropic" {
		// Anthropic 不暴露 /v1/models → UI 据此提示手输 model。
		return nil, apierr.Display(
			http.StatusBadRequest, "no_model_list", ErrNoModelList.Error(),
		)
	}
	if endpoint == "" {
		return nil, apierr.Display(http.StatusBadRequest, "endpoint_required",
			"This provider needs an endpoint URL.")
	}
	return openAIModelsOrDisplay(ctx, endpoint, key)
}

// openAIModelsOrDisplay —— 拉 openai-style /v1/models；网络/HTTP/解码错裹成可回显的
// provider-unreachable（原始 cause 进日志，客户端只见人话）。
// endpoint 可能是调用方直接给的、无 allow-list 的 URL → 出站 client 装 SSRF 守卫
// (BlockInternalEgress)；解析到内部/私网地址的 endpoint 直接回一句点名地址策略的人话
// （不当成「连不上」）。
func openAIModelsOrDisplay(ctx context.Context, baseURL, key string) ([]string, error) {
	models, err := getOpenAIModels(ctx, baseURL, key)
	if err != nil {
		return nil, displayFor(err)
	}
	return models, nil
}

// displayFor —— 三种失败三句话。**「够不着」和「够到了、它拒绝了」不是同一件事**（F-R-12）：
// 前者要去看地址和网络，后者要去看这把 key 的权限 —— 而「列模型」在真 provider 上常常
// 需要跟「聊天」不同的权限，于是一把好用的 key 照样列不出东西。以前这两类塌成同一句
// 「Couldn't reach the model provider」，owner 会去查一个根本没坏的地址。
// 上游的响应体一个字都不外泄（它裹在 cause 里进日志）。
func displayFor(err error) error {
	if errors.Is(err, httpx.ErrBlockedEgress) {
		return apierr.Display(http.StatusBadRequest, "endpoint_blocked",
			"That endpoint resolves to an internal/private address and is not allowed.")
	}
	var refused refusedError
	if errors.As(err, &refused) {
		return refusalDisplay(refused, err)
	}
	return apierr.DisplayWrap(http.StatusBadRequest, "provider_unreachable",
		"Couldn't reach the model provider — check the base URL.", err)
}

// refusalDisplay —— 它答话了，只是不给。三种「不给」要说三句话：
//
//   - 401/403：这把 key 的权限问题 —— owner 要去 provider 那边看这把 key 能做什么。
//   - 429：不是配错了，是**现在**不行 —— 要说的是「等一会儿再点」。少了这一句，owner 会去
//     翻地址和 key，而那两样都没毛病。
//   - 其余：它自己的规矩，如实说「答了话但不给」。
func refusalDisplay(refused refusedError, cause error) error {
	switch {
	case refused.deniedKey():
		return apierr.DisplayWrap(http.StatusBadRequest, "models_forbidden",
			"This provider answered, but refused to list models for this key — "+
				"chat may still work; check what the key is allowed to do.", cause)
	case refused.status == http.StatusTooManyRequests:
		return apierr.DisplayWrap(http.StatusBadRequest, "models_rate_limited",
			"This provider is rate-limiting right now — wait a moment and load the "+
				"models again.", cause)
	default:
		return apierr.DisplayWrap(http.StatusBadRequest, "models_refused",
			"This provider answered, but would not list its models.", cause)
	}
}

// refusedError —— 上游**答话了**，只是拒绝了。带着状态码，好把「权限不够」跟「别的拒绝」分开。
type refusedError struct {
	body   string
	status int
}

func (e refusedError) Error() string {
	return fmt.Sprintf("upstream %d: %s", e.status, e.body)
}

// deniedKey —— 401/403：这把 key 不被允许做这件事。
func (e refusedError) deniedKey() bool {
	return e.status == http.StatusUnauthorized || e.status == http.StatusForbidden
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
	client := httpx.NewClient(httpx.Options{Timeout: listTimeout, BlockInternalEgress: true})
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

// readUpstreamErr —— 上游答了话但不是 2xx。**带上状态码**：调用侧据此把「它拒绝了」
// 跟「够不着」分开（F-R-12）。响应体留在错误里进日志，永远不外泄给调用方。
func readUpstreamErr(resp *http.Response) error {
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, listMaxBodyMiB<<20))
	if rerr != nil {
		body = []byte("(read body err)")
	}
	return refusedError{status: resp.StatusCode, body: string(body)}
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
