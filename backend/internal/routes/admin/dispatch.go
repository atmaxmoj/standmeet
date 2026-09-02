// dispatch.go — the shared plumbing the admin facade uses to wire a route from the
// outbound convergence point.
//
// The division of labor is fixed: **capability** comes from the convergence point
// (declared once, MCP's facade takes the same copy), **protocol shape** stays on this
// facade — the path, the method, whether a parameter goes in body or path, whether a
// success returns 200 with a payload or 204 empty, how an error translates to a status
// code: all of that is still hand-written as before. The convergence point knows nothing
// about any of this; it only gives a function of "JSON in → JSON out / error".
//
// So writing a new admin route stays the same, only where the capability comes from
// changes: instead of importing the domain's facade directly (check-routes-via-dispatcher
// blocks that), it's face.MustOp("resource.op").

package admin

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// argsFrom translates an HTTP request into the args JSON the convergence point wants.
// Whether REST puts a parameter in body / path / query is this facade's decision; these
// small functions are where that decision lands.
type argsFrom func(r *http.Request) (json.RawMessage, error)

// renderOK — how to respond on success. Returning 200 with a payload, or 204 empty, is
// this facade's decision.
type renderOK func(log logger, w http.ResponseWriter, body json.RawMessage)

// logger — a narrow interface using only Error (handlers actually hold a *slog.Logger).
type logger interface {
	Error(msg string, args ...any) //nolint:forbidigo // this is slog's actual signature
}

func emptyArgs(*http.Request) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func bodyArgs(r *http.Request) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return nil, dispatcher.BadInput("invalid JSON body")
	}
	return raw, nil
}

// queryArgs moves the query string (?status=open) into the args JSON. A missing value
// becomes an empty string, matching the convergence point's convention that "empty means
// no filter".
func queryArgs(names ...string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		vals := map[string]string{}
		for _, n := range names {
			vals[n] = r.URL.Query().Get(n)
		}
		out, err := json.Marshal(vals)
		if err != nil {
			return nil, dispatcher.BadInput("invalid query parameters")
		}
		return out, nil
	}
}

// queryArgsRenamed moves the query string into the args JSON, allowing a rename: REST's
// ?q= maps to the convergence point's "query". The name mismatch is this facade's
// historical baggage, and shouldn't force the convergence point to change to match —
// the renaming lands here.
// Entries in numeric are parsed as numbers (the convergence point side has an integer
// field); a failed parse is simply dropped, letting the convergence point apply its
// default.
func queryArgsRenamed(rename map[string]string, numeric ...string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		q := r.URL.Query()
		fields := map[string]json.RawMessage{}
		for from, to := range rename {
			fields[to] = json.RawMessage(strconv.Quote(q.Get(from)))
		}
		addNumericQuery(fields, q, numeric)
		out, err := json.Marshal(fields)
		if err != nil {
			return nil, dispatcher.BadInput("invalid query parameters")
		}
		return out, nil
	}
}

// addNumericQuery handles the numeric query entries. A failed parse is simply dropped,
// letting the convergence point apply its default — ?limit=abc shouldn't be an error,
// it's just "unstated".
func addNumericQuery(fields map[string]json.RawMessage, q url.Values, names []string) {
	for _, n := range names {
		if v, err := strconv.Atoi(q.Get(n)); err == nil {
			fields[n] = json.RawMessage(strconv.Itoa(v))
		}
	}
}

// bodyWithURLParam merges the body's fields + path parameters into one args. REST's
// convention puts the resource id in the path and everything else in the body
// (PATCH /x/{id} + {"status":...}); the convergence point only accepts one flat args
// shape, and the merge lands here.
func bodyWithURLParam(names ...string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		fields, err := decodeBodyFields(r)
		if err != nil {
			return nil, err
		}
		return mergeURLParams(r, fields, names)
	}
}

// mergeURLParams overlays path parameters onto the body's fields, producing one flat args.
func mergeURLParams(
	r *http.Request, fields map[string]json.RawMessage, names []string,
) (json.RawMessage, error) {
	for _, name := range names {
		fields[name] = json.RawMessage(strconv.Quote(chi.URLParam(r, name)))
	}
	out, err := json.Marshal(fields)
	if err != nil {
		return nil, dispatcher.BadInput("invalid request")
	}
	return out, nil
}

// decodeBodyFields decodes the body into a flat field table. An empty body is legal
// (some PATCH routes rely on path parameters alone); a genuine decode failure is what
// counts as the caller's mistake. The server's r.Body is never nil (at most http.NoBody).
func decodeBodyFields(r *http.Request) (map[string]json.RawMessage, error) {
	fields := map[string]json.RawMessage{}
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil && !errors.Is(err, io.EOF) {
		return nil, dispatcher.BadInput("invalid JSON body")
	}
	return fields, nil
}

// urlParamArgs moves the path parameter (/{id}) into its slot in the args JSON.
func urlParamArgs(name string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		out, err := json.Marshal(map[string]string{name: chi.URLParam(r, name)})
		if err != nil {
			return nil, dispatcher.BadInput("invalid path parameter")
		}
		return out, nil
	}
}

// jsonOK — 200 + writes the convergence point's payload out verbatim (never decode and
// re-encode it: re-encoding would just build a second copy of the shape).
func jsonOK(log logger, w http.ResponseWriter, body json.RawMessage) {
	writeStatusBody(log, w, http.StatusOK, body)
}

func writeStatusBody(log logger, w http.ResponseWriter, status int, body json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		log.Error("write json", logErrKey, err)
	}
}

// jsonListOK — 200 + wraps the convergence point's array in {"<key>": [...]}. Some admin
// routes have historically returned it this way, and the frontend is written against that
// contract; the convergence point side is a bare array (which is what MCP's facade
// wants). Adding this wrapper is this facade's own shape decision.
func jsonListOK(key string) renderOK {
	return func(log logger, w http.ResponseWriter, body json.RawMessage) {
		wrapped, err := json.Marshal(map[string]json.RawMessage{key: body})
		if err != nil {
			log.Error("wrap list body", logErrKey, err)
			wrapped = body
		}
		writeStatusBody(log, w, http.StatusOK, wrapped)
	}
}

// jsonCreated — 201 + payload. Resource-creating routes have historically returned it
// this way.
func jsonCreated(log logger, w http.ResponseWriter, body json.RawMessage) {
	writeStatusBody(log, w, http.StatusCreated, body)
}

// noContent — 204 empty. Some admin routes have historically returned it this way, and
// the frontend is written against that contract.
func noContent(_ logger, w http.ResponseWriter, _ json.RawMessage) {
	w.WriteHeader(http.StatusNoContent)
}

// dispatchOp takes capability from the Face → calls it → translates the result. Failing
// to find the op panics while mounting routes (MustOp), instead of silently missing a
// route at runtime.
func (h *Handlers) dispatchOp(
	face *dispatcher.Face, id string, args argsFrom, render renderOK,
) http.HandlerFunc {
	op := face.MustOp(id)
	return func(w http.ResponseWriter, r *http.Request) {
		in, aerr := args(r)
		if aerr != nil {
			writeError(h.Log, w, envBadReq(aerr.Error()))
			return
		}
		out, err := op.Invoke(r.Context(), middleware.OwnerIDFrom(r.Context()), in)
		if err != nil {
			h.writeOpError(w, id, err)
			return
		}
		render(h.Log, w, out)
	}
}

// writeOpError — the convergence point only gives a protocol-agnostic category; the
// status code is this facade's own translation: the caller's fault → 400, not found → 404,
// everything else is this machine's problem → 500 (details go to the log, never leak out).
func (h *Handlers) writeOpError(w http.ResponseWriter, id string, err error) {
	env, ok := opErrEnvelope(err)
	if !ok {
		h.Log.Error("dispatcher op failed", "op", id, logErrKey, err)
		env = serverErr()
	}
	writeError(h.Log, w, env)
}

// opErrClasses — the convergence point's error categories → this facade's status codes.
// **One category, one line**: this is the rule stated in errors.go, "every added category
// gets one translation line per facade". It's written as data rather than branches because
// it's genuinely a lookup table.
//
// Not in the table = this machine had a problem → generic 500, no message leaks out
// (the details go to the log).
var opErrClasses = []struct {
	is     func(error) bool
	code   string
	status int
}{
	{dispatcher.IsBadInput, "bad_request", http.StatusBadRequest},
	{dispatcher.IsUnauthed, "unauthorized", http.StatusUnauthorized},
	{dispatcher.IsNotFound, "not_found", http.StatusNotFound},
	{dispatcher.IsForbidden, "forbidden", http.StatusForbidden},
	{dispatcher.IsConflict, "conflict", http.StatusConflict},
	{dispatcher.IsUpstream, "upstream_failed", http.StatusBadGateway},
}

// opErrEnvelope looks up the table. ok=false means "none of the categories match", and
// the caller logs it + returns 500 on that basis.
//
// code prefers whatever was explicitly pinned on the error (dispatcher.Coded): something
// like role_name_taken is an already-shipped contract that the frontend branches on. Only
// falls back to the category's default code when nothing was pinned.
func opErrEnvelope(err error) (apierr.Envelope, bool) {
	for _, c := range opErrClasses {
		if c.is(err) {
			return apierr.Envelope{
				Status: c.status, Code: pinnedOr(err, c.code), Message: err.Error(),
			}, true
		}
	}
	return apierr.Envelope{}, false
}

// pinnedOr prefers an explicitly pinned code; falls back to the category's default when
// nothing was pinned.
func pinnedOr(err error, fallback string) string {
	if pinned, ok := dispatcher.CodeOf(err); ok {
		return pinned
	}
	return fallback
}
