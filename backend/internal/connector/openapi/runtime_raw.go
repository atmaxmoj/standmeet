// runtime_raw.go —— agent 路（§3）的无 binding 执行：按 operationId 直调 SaaS，args 原样作
// 请求体，回原始响应（LLM 直接消费 SaaS 形状，无契约/JSONata 映射）。跟 runtime.go 同 Runtime，
// 拆出来守 max-lines。

package openapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Operations —— spec 里所有 operation 的 agent-facing 元数据（agent 路把每个 op 暴露成工具）。
func (r *Runtime) Operations() []OpInfo { return r.spec.Operations() }

// RawCall —— 无 binding 的 agent 路（§3）：按 operationId 直接调 SaaS，args 原样作请求体（无
// JSONata 映射），回原始响应 JSON（LLM 直接消费 SaaS 形状）。auth 注入同 Call。GET 不带体。
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

// rawBody —— GET/DELETE 或无 args → 无体；否则 args 原样作请求体。
func rawBody(method string, args json.RawMessage) io.Reader {
	if method == http.MethodGet || method == http.MethodDelete || len(args) == 0 {
		return nil
	}
	return bytes.NewReader(args)
}

// sendRaw —— 发请求、关体、按状态码归一错误，回原始响应体（不过 response JSONata）。
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

// readAndClose —— 读响应体（限长）+ 关体；读错优先，否则关体错。
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
