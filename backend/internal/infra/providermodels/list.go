// Package providermodels asks an OpenAI-style inference endpoint one question: which
// models do you have.
//
// **Why this doesn't live in the routing layer** (F-R-11): this has **two callers**, and
// they get their key in completely different ways —
//
//   - the visitor side (`/api/v1/inference/models`, no auth): the key is typed live into
//     the BYOAI panel by the caller and rides in with the request.
//   - the owner side: the key **already lives in the DB** (encrypted), and the page can
//     never read it back. The owner opens their configured provider and clicks "load
//     models" — the client has none of those characters on hand. It used to send an empty
//     key anyway, the backend returned `key required` 400, and the screen showed nothing.
//
// The only difference between the two sides is where the key comes from; pulling the list
// is identical either way, so it moved here: outside any domain, stateless, callable by
// whoever holds an (endpoint, key) pair. Unsealing on the owner path still happens only at
// the composition root (`cmd/server/provider_models.go`) — this domain layer never decrypts.
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

// ErrNoModelList is for providers like Anthropic that don't expose /v1/models. The UI uses
// this to prompt for a manually typed model id.
var ErrNoModelList = errors.New(
	"provider does not expose a model list; type model id manually",
)

// List pulls this provider's available models. Returns a DisplayError: every failure
// carries a human-readable message + a machine code + 400, with the raw cause wrapped
// inside (goes to the logs, never to the client).
func List(ctx context.Context, provider, endpoint, key string) ([]string, error) {
	if provider == "anthropic" {
		// Anthropic doesn't expose /v1/models → the UI prompts for a manually typed model.
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

// openAIModelsOrDisplay pulls the openai-style /v1/models; network/HTTP/decode errors are
// wrapped into a displayable provider-unreachable error (raw cause goes to the logs, the
// client only sees the human-readable message).
// endpoint may be a caller-supplied URL with no allow-list → the outbound client wraps an
// SSRF guard (BlockInternalEgress); an endpoint that resolves to an internal/private
// address gets a human-readable message naming the address policy directly (not treated
// as "can't connect").
func openAIModelsOrDisplay(ctx context.Context, baseURL, key string) ([]string, error) {
	models, err := getOpenAIModels(ctx, baseURL, key)
	if err != nil {
		return nil, displayFor(err)
	}
	return models, nil
}

// displayFor turns three kinds of failure into three sentences. **"can't reach it" and
// "reached it, and it refused" are not the same thing** (F-R-12): the former means
// checking the address and the network, the latter means checking what this key is
// allowed to do — and "listing models" on a real provider often needs different
// permissions than "chatting", so a perfectly good key can still fail to list anything.
// These two used to collapse into one sentence, "Couldn't reach the model provider",
// sending the owner to check an address that was never broken.
// Not one byte of the upstream response body leaks out (it stays wrapped in the cause,
// logs only).
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

// refusalDisplay handles the case where it answered, just wouldn't give up the data.
// Three kinds of "won't give it" need three different sentences:
//
//   - 401/403: a permissions problem with this key — the owner needs to check what this
//     key is allowed to do on the provider's side.
//   - 429: not a misconfiguration, just **not right now** — the message needs to say "try
//     again in a moment". Without this line the owner goes and re-checks the address and
//     the key, and neither one is wrong.
//   - anything else: its own rules — say plainly "it answered, but wouldn't give it up".
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

// refusedError means upstream **did answer**, it just refused. Carries the status code
// so callers can separate "not permitted" from other kinds of refusal.
type refusedError struct {
	body   string
	status int
}

func (e refusedError) Error() string {
	return fmt.Sprintf("upstream %d: %s", e.status, e.body)
}

// deniedKey reports 401/403: this key isn't allowed to do this.
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

// readUpstreamErr handles upstream answering but not with 2xx. **Carries the status
// code**: callers use it to separate "it refused" from "couldn't reach it" (F-R-12).
// The response body stays inside the error, goes to the logs, and never leaks to the
// caller.
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
