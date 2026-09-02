// runtime.go — the generic openapi connector runtime (one runtime, handles every openapi
// connector).
//
// Call flow: typed input → JSON → request JSONata builds the body → spec resolves
// operationId into method+path, joins base URL → authInjector adds auth (OAuth bearer /
// apiKey header…, per credential + securityScheme) → HTTP send → status-code error
// normalization (429/5xx transient w/ retry backoff, other 4xx permanent) → response
// JSONata extracts contract output → JSON → decoded into typed dst.
//
// Input/output are typed outside this package (dst is the caller's struct pointer);
// schemaless `any` stays internal to this package's JSON transit. Everything
// provider-specific lives in spec+binding data — no gcal/SendGrid literal appears here.

package openapi

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
)

// Doer — outbound HTTP abstraction (prod uses *http.Client).
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// AuthInjector — adds auth to a request (the decrypted credential + securityScheme decide
// how). The credential never leaves this layer.
type AuthInjector func(req *http.Request) error

// Runtime — one spec + one binding + an outbound client = one callable connector
// implementation. Auth does **not** live here: one connector serves multiple owners and
// the token varies per owner/request, so AuthInjector is passed in on every Call.
type Runtime struct {
	spec    *Spec
	binding *Binding
	doer    Doer
	baseURL string
}

// NewRuntime — assembles a runtime. spec has no server → reject (nowhere to send outbound
// requests).
func NewRuntime(spec *Spec, binding *Binding, doer Doer) (*Runtime, error) {
	base := spec.serverURL()
	if base == "" {
		return nil, ErrSpecNoServer
	}
	return &Runtime{spec: spec, binding: binding, doer: doer, baseURL: base}, nil
}

// StatusError — the normalized error for non-2xx. Transient=true (429/5xx) → the contract
// adapter maps it to "try again later".
type StatusError struct {
	Code      int
	Transient bool
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("connector upstream returned status %d", e.Code)
}

// boundOp — the result of resolve: the binding for a contract method + the concrete HTTP
// operation.
type boundOp struct {
	binding  opBinding
	resolved resolvedOp
}

// ScopesFor lives in scopes.go — "what permission this step needs" and "how to send this
// request" are two different things.

// Call — executes one contract method. op = the contract method name (list_busy/create_event/
// send…); input is typed input (marshaled to JSON to feed the request JSONata); when dst is
// non-nil, the contract output is decoded into it.
func (r *Runtime) Call(ctx context.Context, op string, input, dst any, auth AuthInjector) error {
	bo, err := r.resolve(op)
	if err != nil {
		return err
	}
	inputData, err := toJSONValue(input)
	if err != nil {
		return err
	}
	req, err := r.buildRequest(ctx, &bo, inputData, auth)
	if err != nil {
		return err
	}
	out, err := r.send(req, &bo.binding)
	if err != nil {
		return err
	}
	return decodeInto(out, dst)
}

// Invoke — the JSON in / JSON out version of Call: op is the binding operation name, argsJSON
// feeds the request JSONata as-is, returns contract output as JSON. Used by the generic
// connector call surface (op, argsJSON) → JSON, never a typed struct; same resolve→build→send.
func (r *Runtime) Invoke(
	ctx context.Context, op string, argsJSON json.RawMessage, auth AuthInjector,
) (json.RawMessage, error) {
	bo, err := r.resolve(op)
	if err != nil {
		return nil, err
	}
	input, err := decodeInvokeArgs(op, argsJSON)
	if err != nil {
		return nil, err
	}
	req, err := r.buildRequest(ctx, &bo, input, auth)
	if err != nil {
		return nil, err
	}
	out, err := r.send(req, &bo.binding)
	if err != nil {
		return nil, err
	}
	return marshalInvokeOut(op, out)
}

// decodeInvokeArgs — empty args → nil; otherwise decodes into a JSON value (the JSONata
// input shape).
func decodeInvokeArgs(op string, argsJSON json.RawMessage) (any, error) {
	if len(argsJSON) == 0 {
		return nil, nil
	}
	var input any
	if err := json.Unmarshal(argsJSON, &input); err != nil {
		return nil, fmt.Errorf("connector invoke %q args: %w", op, err)
	}
	return input, nil
}

func marshalInvokeOut(op string, out any) (json.RawMessage, error) {
	res, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("connector invoke %q marshal: %w", op, err)
	}
	return res, nil
}

// resolve — contract method name → binding + concrete HTTP operation. Binding missing that
// method / spec missing that op → error.
func (r *Runtime) resolve(op string) (boundOp, error) {
	ob, ok := r.binding.Operations[op]
	if !ok {
		return boundOp{}, fmt.Errorf("binding has no operation %q", op)
	}
	resolved, ok := r.spec.lookup(ob.Op)
	if !ok {
		return boundOp{}, fmt.Errorf("%w: %q", ErrBindingUnknownOp, ob.Op)
	}
	return boundOp{binding: ob, resolved: resolved}, nil
}

// buildRequest — renders the request body + assembles the URL + injects auth.
func (r *Runtime) buildRequest(
	ctx context.Context, bo *boundOp, input any, auth AuthInjector,
) (*http.Request, error) {
	media := bo.resolved.BodyMedia
	rdr, err := renderBody(&bo.binding, input, bo.resolved.Required, media)
	if err != nil {
		return nil, err
	}
	reqURL, uerr := r.requestURL(bo, input)
	if uerr != nil {
		return nil, uerr
	}
	return newHTTPRequest(ctx, &outbound{
		method: bo.resolved.Method, url: reqURL, body: rdr, media: media, auth: auth,
	})
}

// outbound — all material for one outbound request, in a struct not six params: media type
// arrived later (F-C-54) and tripped the parameter-count gate; these fields describe one thing.
type outbound struct {
	auth   AuthInjector
	body   io.Reader
	method string
	url    string
	media  string
}

// newHTTPRequest — assembles *http.Request: with a body, sets Content-Type to what the spec
// declares (undeclared → JSON, existing behavior), then injects auth last.
func newHTTPRequest(ctx context.Context, o *outbound) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, o.method, o.url, o.body)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	if o.body != nil {
		req.Header.Set("Content-Type", cmp.Or(o.media, "application/json"))
	}
	if aerr := injectAuth(req, o.auth); aerr != nil {
		return nil, aerr
	}
	return req, nil
}

// requestURL / renderQuery live in runtime_query.go; renderBody / media-type encoding /
// required-field pre-flight live in runtime_body.go — both split out for the 350-line gate.

func fieldMissing(m map[string]any, field string) bool {
	v, present := m[field]
	return !present || v == nil
}

// injectAuth — injects auth (no injector → passes through unchanged).
func injectAuth(req *http.Request, auth AuthInjector) error {
	if auth == nil {
		return nil
	}
	if err := auth(req); err != nil {
		return fmt.Errorf("inject auth: %w", err)
	}
	return nil
}

// send — sends the request, closes the body, reads and decodes. If the close error is the
// first error, it surfaces (codebase convention, no named return).
func (r *Runtime) send(req *http.Request, ob *opBinding) (any, error) {
	resp, derr := r.doer.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("connector http call: %w", derr)
	}
	out, perr := readAndParse(resp, ob)
	if cerr := resp.Body.Close(); cerr != nil && perr == nil {
		return out, fmt.Errorf("close response body: %w", cerr)
	}
	return out, perr
}

// readAndParse — reads the body, normalizes errors by status code, extracts contract output
// with the response JSONata.
func readAndParse(resp *http.Response, ob *opBinding) (any, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if rerr != nil {
		return nil, fmt.Errorf("read response: %w", rerr)
	}
	if serr := statusError(resp.StatusCode); serr != nil {
		return nil, serr
	}
	decoded, jerr := decodeJSON(raw)
	if jerr != nil {
		return nil, jerr
	}
	return ob.evalResponse(decoded)
}

// statusError — non-2xx → normalized error (429/5xx marked Transient). 2xx → nil.
func statusError(code int) error {
	if code < http.StatusBadRequest {
		return nil
	}
	transient := code == http.StatusTooManyRequests || code >= http.StatusInternalServerError
	return &StatusError{Code: code, Transient: transient}
}

// decodeJSON — empty body → nil; otherwise decodes into a JSON value.
func decodeJSON(raw []byte) (any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decode response json: %w", err)
	}
	return decoded, nil
}

// toJSONValue — marshal+unmarshal typed input into a JSON value (the JSONata input shape).
func toJSONValue(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal input: %w", err)
	}
	var out any
	if uerr := json.Unmarshal(raw, &out); uerr != nil {
		return nil, fmt.Errorf("normalize input: %w", uerr)
	}
	return out, nil
}

// decodeInto — decodes contract output (a JSON value) into the caller's typed dst; dst nil →
// discarded. Shape mismatch (e.g. SaaS returns an array where an object was expected) degrades
// gracefully: dst keeps its zero value, no error, empty result instead of 5xx (§8-C).
func decodeInto(value, dst any) error {
	if dst == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal output: %w", err)
	}
	decodeOrEmpty(raw, dst)
	return nil
}

// decodeOrEmpty — best-effort decode into dst; shape mismatch → dst keeps its zero value
// (§8-C: treat a provider/contract shape mismatch as "no data", not a failure — empty, not 5xx).
func decodeOrEmpty(raw []byte, dst any) {
	if err := json.Unmarshal(raw, dst); err != nil {
		return
	}
}

// maxResponseBytes — the read cap on an outbound response body (guards against a
// malicious/runaway provider).
const maxResponseBytes = 4 << 20 // 4 MiB

// pathParamRE — the {param} placeholder in a path (e.g. /events/{eventId}).
var pathParamRE = regexp.MustCompile(`\{([^}]+)\}`)

// substitutePath — replaces {param} in the path with the same-named contract-input field
// (gcal's {eventId} etc); missing/non-object input → left as-is (upstream 404s gracefully).
func substitutePath(path string, input any) string {
	m, ok := input.(map[string]any)
	if !ok {
		return path
	}
	return pathParamRE.ReplaceAllStringFunc(path, func(match string) string {
		key := match[1 : len(match)-1]
		if v, found := m[key]; found {
			// PathEscape: value may contain `/`, `?`, `#` etc — escape to prevent path
			// injection (e.g. eventId="../../admin" escaping the intended path).
			return url.PathEscape(fmt.Sprint(v))
		}
		return match
	})
}
