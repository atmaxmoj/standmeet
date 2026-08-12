// binding.go —— 连接器绑定：把品类契约方法（list_busy/create_event/send…）映射到 spec 的
// operationId，并用 **JSONata**（唯一映射语言）声明两向形状转换：request（契约入参 → SaaS
// 请求体）、response（SaaS 响应 → 契约出参）。装配期就把 JSONata 编译掉（语法错当场拒），并
// 校验每个 op 都在 spec、category 已知、必填契约方法映全。

package openapi

import (
	"encoding/json"
	"fmt"

	jsonata "github.com/blues/jsonata-go"
	yaml "go.yaml.in/yaml/v3"
)

// jsonataSrc —— request/response 的 JSONata 源。owner 可写成 JSONata 字符串（标量），也可写成
// 结构化 YAML（map/seq，admin UI 贴的形态）—— 后者按 JSON 序列化成等价的 JSONata 对象构造源。
type jsonataSrc string

func (j *jsonataSrc) UnmarshalYAML(value *yaml.Node) error {
	if value.Kind == yaml.ScalarNode {
		*j = jsonataSrc(value.Value)
		return nil
	}
	var v any
	if err := value.Decode(&v); err != nil {
		return fmt.Errorf("decode binding expr: %w", err)
	}
	raw, merr := json.Marshal(v)
	if merr != nil {
		return fmt.Errorf("marshal binding expr: %w", merr)
	}
	*j = jsonataSrc(raw)
	return nil
}

// CategoryContractOps —— 每个品类契约「必须映全」的方法名。装配期据此判 binding 是否缺映射。
// calendar 必须能查忙时 + 建会（订）；cancel_event 可选（连接器可不支持取消，多映出来则容忍）。
var CategoryContractOps = map[string][]string{
	"calendar": {"list_busy", "create_event"},
	"mail":     {"send"},
}

// opBinding —— 一个契约方法到一个 SaaS 操作的映射 + 三段 JSONata（已编译）。
//
// Query 存在的理由：**有些 SaaS 把动作的一半放在查询参数里，而不是请求体里。** Google
// Calendar 的「通知与会者」就是 `?sendUpdates=all` —— 建会和取消都靠它。这个位置以前不
// 存在：opBinding 只有 op/request/response，路径只做 {param} 替换，于是连接器外置（#155）
// 时那个开关无处安放，被静默丢掉，而契约注释还写着它通知与会者。绑定语言表达不了的东西，
// 迁移时不会报错，只会消失（F-B-7 / [[externalize-is-not-relocate]]）。
type opBinding struct {
	reqExpr   *jsonata.Expr
	respExpr  *jsonata.Expr
	queryExpr *jsonata.Expr
	Op        string     `yaml:"op"`
	Request   jsonataSrc `yaml:"request"`
	Response  jsonataSrc `yaml:"response"`
	// Query —— 求值成一个对象：键是查询参数名，值是标量。值为 null / 空串的键会被丢掉，
	// 所以「按条件才带这个参数」写成 JSONata 三元式即可。
	Query jsonataSrc `yaml:"query"`
}

// Binding —— 一份完整绑定：声明品类 + 各契约方法的映射。
type Binding struct {
	Operations map[string]opBinding `yaml:"operations"`
	Category   string               `yaml:"category"`
	Kind       string               `yaml:"kind"`
}

// ParseBinding —— 解析绑定原文（YAML）+ 当场编译所有 JSONata（语法错即拒）。
func ParseBinding(raw []byte) (*Binding, error) {
	var b Binding
	if err := yaml.Unmarshal(raw, &b); err != nil {
		return nil, fmt.Errorf("parse binding: %w", err)
	}
	for name, ob := range b.Operations {
		if err := compileOpBinding(&ob); err != nil {
			return nil, fmt.Errorf("%w: operation %q: %s", ErrBindingBadJSONata, name, err.Error())
		}
		b.Operations[name] = ob
	}
	return &b, nil
}

func compileOpBinding(ob *opBinding) error {
	slots := []struct {
		dst  **jsonata.Expr
		name string
		src  jsonataSrc
	}{
		{&ob.reqExpr, "request", ob.Request},
		{&ob.respExpr, "response", ob.Response},
		{&ob.queryExpr, "query", ob.Query},
	}
	for _, s := range slots {
		if s.src == "" {
			continue
		}
		e, err := jsonata.Compile(string(s.src))
		if err != nil {
			return fmt.Errorf("%s: %w", s.name, err)
		}
		*s.dst = e
	}
	return nil
}

// ValidateAgainst —— 校验绑定与 spec 自洽：category 已知、每个 op 都在 spec、必填契约方法映全。
func (b *Binding) ValidateAgainst(spec *Spec) error {
	required, known := CategoryContractOps[b.Category]
	if !known {
		return fmt.Errorf("%w: %q", ErrBindingUnknownCategory, b.Category)
	}
	if err := b.checkOpsInSpec(spec); err != nil {
		return err
	}
	return b.checkComplete(required)
}

func (b *Binding) checkOpsInSpec(spec *Spec) error {
	specOps := spec.operationIDs()
	for name, ob := range b.Operations {
		if _, ok := specOps[ob.Op]; !ok {
			return fmt.Errorf("%w: %q → %q", ErrBindingUnknownOp, name, ob.Op)
		}
	}
	return nil
}

func (b *Binding) checkComplete(required []string) error {
	for _, req := range required {
		if _, ok := b.Operations[req]; !ok {
			return fmt.Errorf("%w: %q missing %q", ErrBindingIncomplete, b.Category, req)
		}
	}
	return nil
}

// evalRequest —— 用契约入参（已是 JSON 形状）渲染请求体。无 request JSONata → nil（无体）。
func (ob *opBinding) evalRequest(input any) (any, error) {
	if ob.reqExpr == nil {
		return nil, nil
	}
	out, err := ob.reqExpr.Eval(input)
	if err != nil {
		return nil, fmt.Errorf("eval request jsonata: %w", err)
	}
	return out, nil
}

// evalQuery —— 用契约入参渲染查询参数。无 query JSONata → nil（不带任何参数）。
func (ob *opBinding) evalQuery(input any) (map[string]any, error) {
	if ob.queryExpr == nil {
		return map[string]any{}, nil
	}
	out, err := ob.queryExpr.Eval(input)
	if err != nil {
		return nil, fmt.Errorf("eval query jsonata: %w", err)
	}
	m, ok := out.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: query must evaluate to an object", ErrBindingBadJSONata)
	}
	return m, nil
}

// evalResponse —— 把 SaaS 响应抽成契约出参。无 response JSONata → 原样。
func (ob *opBinding) evalResponse(resp any) (any, error) {
	if ob.respExpr == nil {
		return resp, nil
	}
	out, err := ob.respExpr.Eval(resp)
	if err != nil {
		return nil, fmt.Errorf("eval response jsonata: %w", err)
	}
	return out, nil
}
