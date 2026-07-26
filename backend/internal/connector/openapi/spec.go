// spec.go —— OpenAPI 3.0.x / 3.1.x spec 的最小解析。runtime 只需三样：server base URL、operationId →
// {method,path}、securitySchemes（派生凭据表单 + 注入认证）。自己解析这个子集 = 零重型依赖、
// 最干净。JSON 也是合法 YAML 1.2，所以 owner 贴 JSON 或 YAML spec 都走这一个 parser；收 3.0.x / 3.1.x。

package openapi

import (
	"fmt"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// Spec —— OpenAPI 3.0 文档里 runtime 用得到的子集。
type Spec struct {
	Paths      map[string]map[string]operation `yaml:"paths"`
	Components components                      `yaml:"components"`
	Info       specInfo                        `yaml:"info"`
	OpenAPI    string                          `yaml:"openapi"`
	Servers    []server                        `yaml:"servers"`
}

// specInfo —— spec 的 info 块（摄入候选展示 title 给 owner 确认）。
type specInfo struct {
	Title string `yaml:"title"`
}

// Title —— spec 的 info.title（摄入候选展示）。
func (s *Spec) Title() string { return s.Info.Title }

type server struct {
	URL string `yaml:"url"`
}

type operation struct {
	RequestBody requestBody `yaml:"requestBody"`
	OperationID string      `yaml:"operationId"`
	Summary     string      `yaml:"summary"`
	Description string      `yaml:"description"`
}

// requestBody/mediaType/bodySchema —— 仅取 application/json 的 schema.required（运行时 pre-flight
// 校验：request JSONata 求出的 body 缺必填字段 → 拒，不发畸形请求）。
type requestBody struct {
	Content map[string]mediaType `yaml:"content"`
}

type mediaType struct {
	Schema bodySchema `yaml:"schema"`
}

type bodySchema struct {
	Required []string `yaml:"required"`
}

type components struct {
	SecuritySchemes map[string]SecurityScheme `yaml:"securitySchemes"`
}

// SecurityScheme —— spec 声明的一种认证方式；派生凭据表单 + 注入认证都读它。
type SecurityScheme struct {
	Flows            OAuthFlows `yaml:"flows"`
	Type             string     `yaml:"type"`
	Scheme           string     `yaml:"scheme"`
	In               string     `yaml:"in"`
	Name             string     `yaml:"name"`
	OpenIDConnectURL string     `yaml:"openIdConnectUrl"`
}

// OAuthFlows —— oauth2 的流程集合（派生表单 + dance 用）。
type OAuthFlows struct {
	AuthorizationCode *OAuthFlow `yaml:"authorizationCode"`
	ClientCredentials *OAuthFlow `yaml:"clientCredentials"`
}

// OAuthFlow —— 一个 oauth2 流程的端点 + scope。
type OAuthFlow struct {
	Scopes           map[string]string `yaml:"scopes"`
	AuthorizationURL string            `yaml:"authorizationUrl"`
	TokenURL         string            `yaml:"tokenUrl"`
}

// resolvedOp —— 一个 operationId 解析成的具体 HTTP 操作。
type resolvedOp struct {
	Method   string
	Path     string
	Required []string // requestBody application/json schema.required（pre-flight 校验）
}

// ParseSpec —— 解析 spec 原文（JSON 或 YAML）。非 3.0.x / 3.1.x → 错（版本闸在此）。runtime 只读
// paths/operations、requestBody.required、securitySchemes、servers —— 这几样在 3.0 与 3.1 里结构一致
// （bodySchema 只取 `required` 名单，3.1 的 `type: [..]` 数组落在未声明字段上被忽略），所以 3.1 安全放行。
func ParseSpec(raw []byte) (*Spec, error) {
	var s Spec
	if err := yaml.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("parse openapi spec: %w", err)
	}
	if !strings.HasPrefix(s.OpenAPI, "3.0") && !strings.HasPrefix(s.OpenAPI, "3.1") {
		return nil, fmt.Errorf(
			"unsupported openapi version %q: only 3.0.x / 3.1.x is supported", s.OpenAPI,
		)
	}
	if len(s.Paths) == 0 {
		return nil, ErrSpecNoOperations
	}
	return &s, nil
}

// SecuritySchemes —— spec 声明的认证方式（派生凭据表单用）。
func (s *Spec) SecuritySchemes() map[string]SecurityScheme {
	return s.Components.SecuritySchemes
}

// ServerURLs —— 所有 server 的 base URL（出站 SSRF 守卫装配期校验用）。
func (s *Spec) ServerURLs() []string {
	out := make([]string, 0, len(s.Servers))
	for i := range s.Servers {
		out = append(out, s.Servers[i].URL)
	}
	return out
}

// OpInfo —— 一个 operation 的 agent-facing 元数据（agent 路：每个 op 暴露成一个 tool；
// Summary/Description 喂 LLM 当工具描述选用）。
type OpInfo struct {
	ID          string
	Summary     string
	Description string
}

// Operations —— spec 里所有带 operationId 的 operation（agent 路把每个 op 暴露成一个工具）。
func (s *Spec) Operations() []OpInfo {
	out := make([]OpInfo, 0)
	for _, methods := range s.Paths {
		for _, op := range methods {
			if op.OperationID != "" {
				out = append(out, OpInfo{
					ID: op.OperationID, Summary: op.Summary, Description: op.Description,
				})
			}
		}
	}
	return out
}

// serverURL —— 第一个 server 的 base URL（去尾斜杠）。无 → 空串。
func (s *Spec) serverURL() string {
	if len(s.Servers) == 0 {
		return ""
	}
	return strings.TrimRight(s.Servers[0].URL, "/")
}

// operation —— 按 operationId 找具体 HTTP 操作。未找到 → ok=false。
func (s *Spec) lookup(operationID string) (resolvedOp, bool) {
	for path, methods := range s.Paths {
		for method, op := range methods {
			if op.OperationID == operationID {
				return resolvedOp{
					Method: strings.ToUpper(method), Path: path,
					Required: op.RequestBody.Content["application/json"].Schema.Required,
				}, true
			}
		}
	}
	return resolvedOp{}, false
}

// operationIDs —— spec 里所有 operationId（去重）。绑定校验「引用了不存在的 op」用。
func (s *Spec) operationIDs() map[string]struct{} {
	ids := map[string]struct{}{}
	for _, methods := range s.Paths {
		for _, op := range methods {
			if op.OperationID != "" {
				ids[op.OperationID] = struct{}{}
			}
		}
	}
	return ids
}
