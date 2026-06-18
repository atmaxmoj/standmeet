// binding_tool.go —— Capability 暴露给 visitor agent loop 的"一个 LLM tool"。
//
// H.8 之后 BindingTool 直接持 eino tool.InvokableTool —— backend agent
// loop (H.9 走 eino ADK / ToolsNode) 可以把 BindingTool.Tool 直接 plug
// 进 eino 工具节点；不再有 standmeet 自维护的 ToolExecutor 平行抽象。
//
// 三层：
//
//	Tool          —— eino canonical (Info / InvokableRun)；agent loop 用
//	ProgressLabel —— standmeet 自加：throbber 文案，G-8 之后从 backend 单
//	                 source 下发；不进 eino schema.ToolInfo
//	InputSchema   —— raw JSON Schema 原文 (registered 时给的)。VisitorToolSpec
//	                 (HTTP wire to browser pi-agent-core) 直接转发，不走
//	                 eino ParamsOneOf 反序列化路径，保持 schema 字符串完全
//	                 等同 caller 注册时的写法。

package capreg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"github.com/eino-contrib/jsonschema"
)

var (
	errEmptySchema  = errors.New("capreg: empty schema")
	errSchemaNoType = errors.New("capreg: schema missing type")
)

// BindingTool —— 一个 Capability 暴露的一个 LLM tool。
//
// 构造方式：调 NewTool(...) 或 NewReturnDirectlyTool(...)；不准直接
// struct literal —— 避免 caller 忘设 InputSchema 或不同步 Tool.Info()
// 跟 sidecar 的字段。
//
// Name 是 Tool.Info().Name 的快照，NewTool 注册时一并 stash —— 让 dispatcher
// (routes/public/tools.go findToolInBinding / sys/diag_session 的 appendBinding
// ToolSpecs) 按 name 找 tool 时不必每条都过一遍 ctx + Info() 失败兜底。
//
// ReturnDirectly —— I.1: ask_visitor 那种 tool 调完不该继续 LLM 转圈，
// 直接把 result 当 final 推浏览器；用 eino ADK ToolsConfig.ReturnDirectly
// map 实现。NewReturnDirectlyTool 构造时置 true；老 NewTool 默认 false。
type BindingTool struct {
	Tool           tool.InvokableTool
	Name           string
	ProgressLabel  string
	InputSchema    json.RawMessage
	ReturnDirectly bool
}

// RunFn —— capability 写的 tool 执行闭包。args 是 LLM 喂的 JSON arguments
// (raw string)。返 string text 进 tool_result。
//
// 跟 eino tool.InvokableRun 同形 (s, error)；省一层 wrap。
type RunFn func(ctx context.Context, argsJSON string) (string, error)

// NewTool —— capability 注册一个 LLM tool 的标准构造口。schemaRaw 是
// raw JSON Schema bytes (合法 JSON object，带 type/properties/required)；
// 内部解出 *schema.ParamsOneOf 给 eino，同时原样 stash 到 InputSchema
// 让 visitor wire 直接转发。
//
// schemaRaw 空 / 不带 type → 视作 "无参数"，eino 拿到 nil ParamsOneOf
// (跟 proxy_wire.toEinoToolInfos 同 sentinel 语义)。
func NewTool(
	name, description, progressLabel string,
	schemaRaw json.RawMessage, run RunFn,
) BindingTool {
	info := &schema.ToolInfo{
		Name: name,
		Desc: description,
	}
	if params, err := paramsFromRaw(schemaRaw); err == nil {
		info.ParamsOneOf = params
	}
	return BindingTool{
		Tool:          &funcTool{info: info, run: run},
		Name:          name,
		ProgressLabel: progressLabel,
		InputSchema:   schemaRaw,
	}
}

// NewReturnDirectlyTool —— 跟 NewTool 一样但置 ReturnDirectly=true。
// agent loop 调完直接返，不再多转一圈 LLM；run fn 应该 echo (或者
// 算出一段可直接渲的 result string)。
func NewReturnDirectlyTool(
	name, description, progressLabel string,
	schemaRaw json.RawMessage, run RunFn,
) BindingTool {
	b := NewTool(name, description, progressLabel, schemaRaw, run)
	b.ReturnDirectly = true
	return b
}

// paramsFromRaw —— 跟 inference.proxy_wire 同套解析逻辑：空 schema → nil,
// 解析失败 → 调用方拿到 error 自己决定 (NewTool 当前选择 swallow，让
// "无参数 tool" 也能注册)。
func paramsFromRaw(raw json.RawMessage) (*schema.ParamsOneOf, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errEmptySchema
	}
	var js jsonschema.Schema
	if err := json.Unmarshal(raw, &js); err != nil {
		return nil, fmt.Errorf("capreg: schema decode: %w", err)
	}
	if js.Type == "" {
		return nil, errSchemaNoType
	}
	return schema.NewParamsOneOfByJSONSchema(&js), nil
}

// funcTool —— 一个最小 tool.InvokableTool 实现，把 caller 提供的 RunFn
// 拌进 eino 接口。eino-ext 里 utils.InferTool 走 reflection 自动绑 typed
// arg 函数；我们的 capability 直接吃 raw JSON args (跟 LLM tool_use API
// 同源)，用不上反射，自写更轻。
type funcTool struct {
	info *schema.ToolInfo
	run  RunFn
}

func (t *funcTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return t.info, nil
}

func (t *funcTool) InvokableRun(
	ctx context.Context, argumentsInJSON string, _ ...tool.Option,
) (string, error) {
	return t.run(ctx, argumentsInJSON)
}

// FlattenResult is the return of FlattenBindings: 一份 eino tool 集合 +
// 一份 name → progress_label 表 + I.1 ReturnDirectly 名集合。Struct return
// 是为同时消 gocritic unnamedResult / nonamedreturns 两个互斥 lint。
// 字段顺序按 fieldalignment 排：map (8 pointer bytes) 在前，slice 在后。
type FlattenResult struct {
	Labels         map[string]string
	ReturnDirectly map[string]bool
	Tools          []tool.BaseTool
}

// FlattenBindings 走每个 Binding 的 BindingTool 列表，抽 Tool 拼成
// []tool.BaseTool 喂 eino，同时收集 ProgressLabel + ReturnDirectly 名
// 表 (SSE tool_started 帧 + eino ADK ToolsConfig 用)。
func FlattenBindings(bindings []*Binding) FlattenResult {
	out := FlattenResult{
		Labels:         map[string]string{},
		ReturnDirectly: map[string]bool{},
		Tools:          make([]tool.BaseTool, 0),
	}
	for _, b := range bindings {
		for i := range b.Tools {
			absorbTool(&out, &b.Tools[i])
		}
	}
	return out
}

func absorbTool(out *FlattenResult, t *BindingTool) {
	out.Tools = append(out.Tools, t.Tool)
	if t.ProgressLabel != "" {
		out.Labels[t.Name] = t.ProgressLabel
	}
	if t.ReturnDirectly {
		out.ReturnDirectly[t.Name] = true
	}
}
