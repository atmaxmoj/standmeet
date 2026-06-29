// runtime.go —— 通用 openapi 连接器 runtime（**一个**，通吃所有 openapi 连接器）。
//
// Call 一次契约方法的全过程：
//   typed 入参 → JSON → request JSONata 渲染成请求体
//     → spec 把 operationId 解析成 method+path，拼 base URL
//     → authInjector 注入认证（OAuth bearer / apiKey 头…，由凭据 + securityScheme 决定）
//     → 发 HTTP → 按状态码归一错误（429/5xx = 可退避瞬时；其余 4xx = 永久）
//     → response JSONata 抽成契约出参 → JSON → 解进 typed dst
//
// 入参/出参对包外是**带类型**的（dst 是调用方的结构体指针）；schemaless 的 `any` 只活在本包
// 内的 JSON 中转里，不外泄。provider 的一切都在 spec+binding 数据里，没有任何 gcal/SendGrid 字样。

package openapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
)

// Doer —— 出站 HTTP 抽象（prod 用 *http.Client）。
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// AuthInjector —— 给请求加认证（解密后的凭据 + securityScheme 决定怎么加）。凭据永不出本层。
type AuthInjector func(req *http.Request) error

// Runtime —— 一份 spec + 一份 binding + 出站客户端 = 一个可调的连接器实现。认证**不**存在
// 这里：一个连接器服务多 owner，token 随 owner/请求变，所以 AuthInjector 是每次 Call 传入的。
type Runtime struct {
	spec    *Spec
	binding *Binding
	doer    Doer
	baseURL string
}

// NewRuntime —— 组装 runtime。spec 无 server → 拒（出站没地址）。
func NewRuntime(spec *Spec, binding *Binding, doer Doer) (*Runtime, error) {
	base := spec.serverURL()
	if base == "" {
		return nil, ErrSpecNoServer
	}
	return &Runtime{spec: spec, binding: binding, doer: doer, baseURL: base}, nil
}

// StatusError —— 非 2xx 的归一错误。Transient=true（429/5xx）→ 契约适配器映射成「稍后再试」。
type StatusError struct {
	Code      int
	Transient bool
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("connector upstream returned status %d", e.Code)
}

// boundOp —— resolve 的结果：契约方法对应的绑定 + 具体 HTTP 操作。
type boundOp struct {
	binding  opBinding
	resolved resolvedOp
}

// Call —— 执行一个契约方法。op = 契约方法名（list_busy/create_event/send…）；input 是带类型
// 入参（marshal 成 JSON 喂 request JSONata）；dst 非 nil 时把契约出参解进它。
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
	out, err := r.send(req, bo.binding)
	if err != nil {
		return err
	}
	return decodeInto(out, dst)
}

// resolve —— 契约方法名 → 绑定 + 具体 HTTP 操作。绑定缺该方法 / spec 缺该 op → 错。
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

// buildRequest —— 渲染请求体 + 拼 URL + 注入认证。
func (r *Runtime) buildRequest(
	ctx context.Context, bo *boundOp, input any, auth AuthInjector,
) (*http.Request, error) {
	rdr, err := renderBody(bo.binding, input, bo.resolved.Required)
	if err != nil {
		return nil, err
	}
	url := r.baseURL + substitutePath(bo.resolved.Path, input)
	req, rerr := http.NewRequestWithContext(ctx, bo.resolved.Method, url, rdr)
	if rerr != nil {
		return nil, fmt.Errorf("build request: %w", rerr)
	}
	if rdr != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if aerr := injectAuth(req, auth); aerr != nil {
		return nil, aerr
	}
	return req, nil
}

// renderBody —— request JSONata → 请求体 reader。pre-flight 校验必填字段（缺 → 拒，不发畸形
// 请求）。无体 → nil reader（合法空）。
func renderBody(ob opBinding, input any, required []string) (io.Reader, error) {
	body, err := ob.evalRequest(input)
	if err != nil {
		return nil, err
	}
	if verr := checkRequired(body, required); verr != nil {
		return nil, verr
	}
	if body == nil {
		return nil, nil
	}
	raw, merr := json.Marshal(body)
	if merr != nil {
		return nil, fmt.Errorf("marshal request body: %w", merr)
	}
	return bytes.NewReader(raw), nil
}

// checkRequired —— body 缺任一必填字段（缺键或值 null）→ ErrMissingRequired（pre-flight 拒）。
func checkRequired(body any, required []string) error {
	if len(required) == 0 {
		return nil
	}
	m, ok := body.(map[string]any)
	if !ok {
		m = nil // 非对象 body → 视作所有必填都缺
	}
	for _, f := range required {
		if fieldMissing(m, f) {
			return fmt.Errorf("%w: %q", ErrMissingRequired, f)
		}
	}
	return nil
}

func fieldMissing(m map[string]any, field string) bool {
	v, present := m[field]
	return !present || v == nil
}

// injectAuth —— 注入认证（无 injector → 直接放行）。
func injectAuth(req *http.Request, auth AuthInjector) error {
	if auth == nil {
		return nil
	}
	if err := auth(req); err != nil {
		return fmt.Errorf("inject auth: %w", err)
	}
	return nil
}

// send —— 发请求、关体、读解。关体错若是首个错则冒出来（codebase 惯用法，无 named return）。
func (r *Runtime) send(req *http.Request, ob opBinding) (any, error) {
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

// readAndParse —— 读体、按状态码归一错误、用 response JSONata 抽契约出参。
func readAndParse(resp *http.Response, ob opBinding) (any, error) {
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

// statusError —— 非 2xx → 归一错误（429/5xx 标 Transient）。2xx → nil。
func statusError(code int) error {
	if code < http.StatusBadRequest {
		return nil
	}
	transient := code == http.StatusTooManyRequests || code >= http.StatusInternalServerError
	return &StatusError{Code: code, Transient: transient}
}

// decodeJSON —— 空体 → nil；否则解成 JSON 值。
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

// toJSONValue —— 把带类型入参 marshal+unmarshal 成 JSON 值（JSONata 的输入形态）。
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

// decodeInto —— 把契约出参（JSON 值）解进调用方的 typed dst。dst nil → 丢弃。SaaS 形状不符
// （该回 object 却回 array → 求值出的值塞不进标量字段）时**优雅降级**：dst 保持零值、不报错，
// 契约方法返回空结果而非 5xx（§8-C：shape mismatch degrades cleanly, no garbage）。
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

// decodeOrEmpty —— best-effort 解 JSON 进 dst；形状不符 → dst 留零值（§8-C：provider 回的形状跟
// 契约 dst 不符按「无数据」处理，不是故障，不上报，契约方法返空而非 5xx）。
func decodeOrEmpty(raw []byte, dst any) {
	if err := json.Unmarshal(raw, dst); err != nil {
		return
	}
}

// maxResponseBytes —— 出站响应体读取上限（防恶意/失控 provider）。
const maxResponseBytes = 4 << 20 // 4 MiB

// pathParamRE —— 路径里的 {param} 占位（如 /events/{eventId}）。
var pathParamRE = regexp.MustCompile(`\{([^}]+)\}`)

// substitutePath —— 把路径里的 {param} 用契约入参里的同名字段替换（gcal 的 {eventId} 等）。
// 入参不是对象、或字段缺失 → 原样保留（上游会 404，走友好降级）。
func substitutePath(path string, input any) string {
	m, ok := input.(map[string]any)
	if !ok {
		return path
	}
	return pathParamRE.ReplaceAllStringFunc(path, func(match string) string {
		key := match[1 : len(match)-1]
		if v, found := m[key]; found {
			return fmt.Sprint(v)
		}
		return match
	})
}
