// assemble.go —— manifest → 装配好的连接器。归一化的装配入口：内置（仓库里的 spec+binding
// 文件）和上传（owner 在 UI 贴的）走**同一个** Assemble，唯一区别是 manifest 数据哪来。
// 装配 = 解析 spec + binding → 校验自洽 → 选认证策略 → 建 runtime → 按品类包成对应契约适配器。

package connector

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// errConnectorWrap —— 装配期错误统一前缀（带连接器 id）。
const errConnectorWrap = "connector %q: %w"

// Manifest —— 一个连接器的声明（数据，非代码）。openapi: spec+binding（+ owner 选的 AuthScheme）；
// protocol: 由 Protocol 字段选内置协议 runtime（P3）。内置与上传同构，只是数据来源不同。
type Manifest struct {
	ID         string
	Kind       string // "openapi" | "protocol"
	Category   string
	Protocol   string // protocol kind: "smtp" | "caldav"
	AuthScheme string // openapi: owner 选中的 securityScheme key（空 = spec 里唯一那个）
	Spec       []byte
	Binding    []byte
}

// parsed —— 解析 + 校验后的 spec/binding（function-result-limit ≤2，用结构体承载）。
type parsed struct {
	spec    *openapi.Spec
	binding *openapi.Binding
}

// AssembleOpenAPI —— 把一份 openapi manifest 装配成 Connector。解析/校验/选策略任一步失败 → 错
// （装配期当场拒，回 admin 友好提示）。返回的具体类型按绑定品类是 calendarAdapter / mailAdapter。
func AssembleOpenAPI(
	m *Manifest, doer openapi.Doer, store ConnectionStore, allow EgressAllow,
) (Connector, error) {
	p, err := parseAndValidate(m, allow)
	if err != nil {
		return nil, err
	}
	auth, aerr := resolveAuth(p.spec, m.AuthScheme)
	if aerr != nil {
		return nil, fmt.Errorf(errConnectorWrap, m.ID, aerr)
	}
	rt, rerr := openapi.NewRuntime(p.spec, p.binding, doer)
	if rerr != nil {
		return nil, fmt.Errorf(errConnectorWrap, m.ID, rerr)
	}
	core := &openapiCore{
		runtime: rt, store: store, auth: auth, id: m.ID,
		refresher: buildRefresher(p.spec, m.AuthScheme, doer, store),
	}
	return adaptByCategory(p.binding.Category, core)
}

// checkEgress —— 装配期 SSRF 静态校验：servers[].url + oauth token URL 指内网 → 拒（不建连接器）。
// authorize URL 是浏览器跟的、后端不打，不校验（否则 e2e 的 localhost authorize 会被误伤）。
func checkEgress(spec *openapi.Spec, schemeName string, allow EgressAllow) error {
	for _, u := range spec.ServerURLs() {
		if err := allow.CheckEgressURL(u); err != nil {
			return err
		}
	}
	if ep, err := oauthEndpointsFromSpec(spec, schemeName); err == nil {
		if cerr := allow.CheckEgressURL(ep.TokenURL); cerr != nil {
			return cerr
		}
	}
	return nil
}

// BindingCategory —— 解析 manifest 的 binding，取声明的品类（admin 建上传连接器时用，定占哪个槽）。
func BindingCategory(m *Manifest) (string, error) {
	b, err := openapi.ParseBinding(m.Binding)
	if err != nil {
		return "", fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	return b.Category, nil
}

// parseAndValidate —— 解析 spec → SSRF 出站校验（安全闸先于 binding 语义）→ 解析 binding + 校验自洽。
func parseAndValidate(m *Manifest, allow EgressAllow) (parsed, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return parsed{}, fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	if eerr := checkEgress(spec, m.AuthScheme, allow); eerr != nil {
		return parsed{}, fmt.Errorf(errConnectorWrap, m.ID, eerr)
	}
	binding, berr := openapi.ParseBinding(m.Binding)
	if berr != nil {
		return parsed{}, fmt.Errorf(errConnectorWrap, m.ID, berr)
	}
	if verr := binding.ValidateAgainst(spec); verr != nil {
		return parsed{}, fmt.Errorf(errConnectorWrap, m.ID, verr)
	}
	return parsed{spec: spec, binding: binding}, nil
}

// resolveAuth —— 选 securityScheme + 建注入策略。
//
//nolint:ireturn // 透传 buildAuthStrategy 的工厂返值（按 scheme 类型返不同实现）。
func resolveAuth(spec *openapi.Spec, schemeName string) (authStrategy, error) {
	scheme, serr := pickScheme(spec, schemeName)
	if serr != nil {
		return nil, serr
	}
	return buildAuthStrategy(&scheme)
}

// pickScheme —— 选 owner 指定的 securityScheme；未指定且唯一 → 用那个；多个未指定 → 拒（决策#3
// owner 必须选）；一个都没有 → 拒。
func pickScheme(spec *openapi.Spec, name string) (openapi.SecurityScheme, error) {
	schemes := spec.SecuritySchemes()
	if len(schemes) == 0 {
		return openapi.SecurityScheme{}, errNoAuthScheme
	}
	if name != "" {
		return schemeByName(schemes, name)
	}
	return soleScheme(schemes)
}

func schemeByName(
	schemes map[string]openapi.SecurityScheme, name string,
) (openapi.SecurityScheme, error) {
	s, ok := schemes[name]
	if !ok {
		return openapi.SecurityScheme{}, fmt.Errorf("%w: %q", errUnknownScheme, name)
	}
	return s, nil
}

func soleScheme(schemes map[string]openapi.SecurityScheme) (openapi.SecurityScheme, error) {
	if len(schemes) > 1 {
		return openapi.SecurityScheme{}, errSchemeAmbiguous
	}
	for _, s := range schemes {
		return s, nil
	}
	return openapi.SecurityScheme{}, errNoAuthScheme
}

// adaptByCategory —— 按品类把执行核包成对应契约适配器。未知品类 → 错。
func adaptByCategory(category string, core *openapiCore) (Connector, error) {
	switch category {
	case "calendar":
		return calendarAdapter{core}, nil
	case "mail":
		return mailAdapter{core}, nil
	default:
		return nil, fmt.Errorf("%w: %q", openapi.ErrBindingUnknownCategory, category)
	}
}
