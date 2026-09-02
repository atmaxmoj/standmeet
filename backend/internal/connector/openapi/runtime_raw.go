// runtime_raw.go — bindingless execution for the agent path (§3): calls the SaaS directly by
// operationId, args go through as the request body unchanged, returns the raw response (the
// LLM consumes the SaaS shape directly, no contract/JSONata mapping). Same Runtime as
// runtime.go, split out to stay under max-lines.

package openapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Operations — agent-facing metadata for every operation in the spec (the agent path exposes
// each op as a tool).
func (r *Runtime) Operations() []OpInfo { return r.spec.Operations() }

// RawCall — the bindingless agent path (§3): calls the SaaS directly by operationId, args go
// through as the request body unchanged (no JSONata mapping), returns the raw response JSON
// (the LLM consumes the SaaS shape directly). Auth injection is the same as Call. GET carries
// no body.
func (r *Runtime) RawCall(
	ctx context.Context, operationID string, args json.RawMessage, auth AuthInjector,
) (json.RawMessage, error) {
	op, ok := r.spec.lookup(operationID)
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrBindingUnknownOp, operationID)
	}
	var input any
	if len(args) > 0 {
		if err := json.Unmarshal(args, &input); err != nil {
			return nil, fmt.Errorf("agent call args: %w", err)
		}
	}
	req, err := r.buildRawRequest(ctx, op, args, input, auth)
	if err != nil {
		return nil, err
	}
	return r.sendRaw(req)
}

func (r *Runtime) buildRawRequest(
	ctx context.Context, op resolvedOp, args json.RawMessage, input any, auth AuthInjector,
) (*http.Request, error) {
	rdr := rawBody(op.Method, args)
	url := r.baseURL + substitutePath(op.Path, input)
	req, rerr := http.NewRequestWithContext(ctx, op.Method, url, rdr)
	if rerr != nil {
		return nil, fmt.Errorf("build agent request: %w", rerr)
	}
	if rdr != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if aerr := injectAuth(req, auth); aerr != nil {
		return nil, aerr
	}
	return req, nil
}

// rawBody — GET/DELETE or no args → no body; otherwise args go through as the request body
// unchanged.
func rawBody(method string, args json.RawMessage) io.Reader {
	if method == http.MethodGet || method == http.MethodDelete || len(args) == 0 {
		return nil
	}
	return bytes.NewReader(args)
}

// sendRaw — sends the request, closes the body, normalizes errors by status code, returns
// the raw response body (does not go through response JSONata).
func (r *Runtime) sendRaw(req *http.Request) (json.RawMessage, error) {
	resp, derr := r.doer.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("connector http call: %w", derr)
	}
	raw, rerr := readAndClose(resp)
	if rerr != nil {
		return nil, rerr
	}
	if serr := statusError(resp.StatusCode); serr != nil {
		return nil, serr
	}
	return json.RawMessage(raw), nil
}

// readAndClose — reads the response body (length-capped) + closes it; a read error takes
// priority, otherwise a close error.
func readAndClose(resp *http.Response) ([]byte, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	cerr := resp.Body.Close()
	if rerr != nil {
		return raw, fmt.Errorf("read response: %w", rerr)
	}
	if cerr != nil {
		return raw, fmt.Errorf("close response body: %w", cerr)
	}
	return raw, nil
}
