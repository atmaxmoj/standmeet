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

// opBinding —— 一个契约方法到一个 SaaS 操作的映射 + 两向 JSONata（已编译）。
type opBinding struct {
	reqExpr  *jsonata.Expr
	respExpr *jsonata.Expr
	Op       string     `yaml:"op"`
	Request  jsonataSrc `yaml:"request"`
	Response jsonataSrc `yaml:"response"`
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
		compiled, err := compileOpBinding(ob)
		if err != nil {
			return nil, fmt.Errorf("%w: operation %q: %s", ErrBindingBadJSONata, name, err.Error())
		}
		b.Operations[name] = compiled
	}
	return &b, nil
}

func compileOpBinding(ob opBinding) (opBinding, error) {
	if ob.Request != "" {
		e, err := jsonata.Compile(string(ob.Request))
		if err != nil {
			return ob, fmt.Errorf("request: %w", err)
		}
		ob.reqExpr = e
	}
	if ob.Response != "" {
		e, err := jsonata.Compile(string(ob.Response))
		if err != nil {
			return ob, fmt.Errorf("response: %w", err)
		}
		ob.respExpr = e
	}
	return ob, nil
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
func (ob opBinding) evalRequest(input any) (any, error) {
	if ob.reqExpr == nil {
		return nil, nil
	}
	out, err := ob.reqExpr.Eval(input)
	if err != nil {
		return nil, fmt.Errorf("eval request jsonata: %w", err)
	}
	return out, nil
}

// evalResponse —— 把 SaaS 响应抽成契约出参。无 response JSONata → 原样。
func (ob opBinding) evalResponse(resp any) (any, error) {
	if ob.respExpr == nil {
		return resp, nil
	}
	out, err := ob.respExpr.Eval(resp)
	if err != nil {
		return nil, fmt.Errorf("eval response jsonata: %w", err)
	}
	return out, nil
}
