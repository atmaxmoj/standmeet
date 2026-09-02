// inference_models.go —— POST /api/v1/inference/models —— once the visitor picks a
// provider and enters key + endpoint in the BYOAI panel, this endpoint is called to
// pull the real, available model list (the "Load models" button). No auth: the caller
// must already know (endpoint, key) to call it, the server only proxies the upstream
// /v1/models, and holds no risk state of its own.
//
// **The owner side never takes this path** (F-R-11): their key lives in the database
// and the page never reads it back, so that side is `providers.list_models` (unwrapped
// by the composition root, see cmd/server/provider_models.go). Pulling the list itself
// is shared by both sides through `infra/providermodels`.
//
// Deliberately no default-model fallback: when the list can't be produced, the UI just
// prompts the user to type their own. Anthropic doesn't expose /v1/models → 400 + an
// error message, which the UI translates to "this provider doesn't expose models; type
// manually".

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
			// err is a DisplayError (the fetch layer carries its own display message):
			// Warn logs Error() (including the underlying cause, so ops can see the real
			// upstream HTTP body / dial error), while Classify only sends DisplayMessage
			// to the browser.
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

// missingListModelsField —— on this path key is **required**: it has no auth, and the
// caller is the one holding the key. The owner path is the opposite (they never send a
// key, the server unwraps the one in the database), so each path has its own required
// fields.
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
