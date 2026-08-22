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
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

// ScopesFor 在 scopes.go —— 「这一步要什么权限」跟「怎么发这个请求」是两件事。

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
	out, err := r.send(req, &bo.binding)
	if err != nil {
		return err
	}
	return decodeInto(out, dst)
}

// Invoke —— Call 的 **JSON 进 / JSON 出** 版:op = 绑定操作名,argsJSON 原样喂 request JSONata,
// 回契约出参的 JSON。泛型 connector 调用面用它 —— 消费方只见 (op, argsJSON) → JSON,不碰任何
// typed 契约结构(CalendarProxy 那种)。走同一条 resolve→build→send,只是两端换成 JSON。
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

// decodeInvokeArgs —— 空 args → nil；否则解成 JSON 值(JSONata 输入形态)。
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

// outbound —— 一次出站请求的全部材料。凑成一个结构而不是六个参数：媒体类型是后加的
// （F-C-54），加完就顶到了参数个数的闸 —— 而这几样本来就描述同一件事。
type outbound struct {
	auth   AuthInjector
	body   io.Reader
	method string
	url    string
	media  string
}

// newHTTPRequest —— 组装 *http.Request：有体则声明**spec 说的那个** content-type，最后注入认证。
// 没声明的按 JSON（既有连接器行为一字不变）。
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

// requestURL / renderQuery 在 runtime_query.go；请求体那一族（renderBody / 按 spec 声明的
// 媒体类型编码 / 必填 pre-flight）在 runtime_body.go —— 都是守 max-lines 350 拆出去的。

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

// readAndParse —— 读体、按状态码归一错误、用 response JSONata 抽契约出参。
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
			// PathEscape:param 值可能含 `/`、`?`、`#` 等 —— 转义防 path-injection
			// (如 eventId="../../admin" 逃出预期路径)。
			return url.PathEscape(fmt.Sprint(v))
		}
		return match
	})
}
