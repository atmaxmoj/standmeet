// spec.go —— OpenAPI 3.0.x / 3.1.x spec 的最小解析。runtime 只需三样：server base URL、operationId →
// {method,path}、securitySchemes（派生凭据表单 + 注入认证）。自己解析这个子集 = 零重型依赖、
// 最干净。JSON 也是合法 YAML 1.2，所以 owner 贴 JSON 或 YAML spec 都走这一个 parser；收 3.0.x / 3.1.x。

package openapi

import (
	"fmt"
	"slices"
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
	// Security —— **这一个动作**需要哪些 scope。OpenAPI 的标准位置。
	//
	// 跟 components.securitySchemes 下那份 scope 表不是一回事：那份说的是「这个连接器
	// 可能会要哪些」，这一份说的是「这一步要哪一个」。少了这一份，宿主手里只有
	// 「owner 授到了什么」而没有可对照的另一半，于是只授了只读的连接照旧把写操作
	// 摆给访客，每一次都 403（F-B-8）。
	Security []map[string][]string `yaml:"security"`
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
	Method string
	Path   string
	// BodyMedia —— requestBody 声明的媒体类型。**从 spec 读，不假设**（F-C-54）：以前这里
	// 只看 `application/json`，运行时也写死发 JSON，于是任何表单编码的 vendor 都发不出去 ——
	// 真 Mailgun 对一份 JSON body 的回答是 `400 from parameter is missing`，它只是没看见那些字段。
	// Mailgun / Twilio / Stripe 都是这一类。空 = 没声明请求体。
	BodyMedia string
	Required  []string // 选中那份媒体类型的 schema.required（pre-flight 校验）
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

// ScopesFor —— **这个 operation 需要哪些 scope**（spec 自己声明的那一份）。
// 没声明 → 空切片，调用方据此当「这一步不要求额外权限」。
//
// 这是「授到的 ⊇ 需要的」那句判断的右半边。左半边（授到了什么）在连接行上。
// 两边都必须是**数据**：把 scope 名抄进 Go 就会有第二份真相，而它迟早跟 spec 分叉
// （F-B-8 / [[vocabulary-must-not-diverge]]）。
func (s *Spec) ScopesFor(operationID string) []string {
	for _, methods := range s.Paths {
		for _, op := range methods {
			if op.OperationID == operationID {
				return flattenSecurity(op.Security)
			}
		}
	}
	// 空切片，不是 nil —— 我上面那句注释写的就是「空切片」，代码却 return nil，
	// 而闸门当场把这处不一致挡了下来（collections always return empty）。
	return []string{}
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
				media, schema := pickBodyMedia(op.RequestBody.Content)
				return resolvedOp{
					Method: strings.ToUpper(method), Path: path,
					BodyMedia: media, Required: schema.Required,
				}, true
			}
		}
	}
	return resolvedOp{}, false
}

// pickBodyMedia —— requestBody 声明了哪种媒体类型。**JSON 优先**（既有连接器一个字都不变），
// 没有 JSON 就取声明里字典序最小的那一个 —— 要的是**确定**，map 的遍历顺序不是。
// 一个都没有 = 这个操作没有请求体。
func pickBodyMedia(content map[string]mediaType) (string, bodySchema) {
	if m, ok := content["application/json"]; ok {
		return "application/json", m.Schema
	}
	names := make([]string, 0, len(content))
	for name := range content {
		names = append(names, name)
	}
	if len(names) == 0 {
		return "", bodySchema{}
	}
	slices.Sort(names)
	return names[0], content[names[0]].Schema
}

// flattenSecurity —— OpenAPI 的 security 是「一组备选方案，每个方案是 scheme→scopes」。
// 我们只用一种认证方式，所以摊平去重就够；哪天真有两种备选，这里必须改成
// 「任一方案满足即可」，而不是现在这样合并（写在这儿，免得那天读错）。
func flattenSecurity(security []map[string][]string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, alt := range security {
		out = appendUnseen(out, seen, alt)
	}
	return out
}

func appendUnseen(out []string, seen map[string]bool, alt map[string][]string) []string {
	for _, scopes := range alt {
		for _, sc := range scopes {
			if seen[sc] {
				continue
			}
			seen[sc] = true
			out = append(out, sc)
		}
	}
	return out
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
