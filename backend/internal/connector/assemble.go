// assemble.go —— manifest → 装配好的连接器。归一化的装配入口：内置（仓库里的 spec+binding
// 文件）和上传（owner 在 UI 贴的）走**同一个** Assemble，唯一区别是 manifest 数据哪来。
// 装配 = 解析 spec + binding → 校验自洽 → 选认证策略 → 建 runtime → 按品类包成对应契约适配器。

package connector

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

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
func AssembleOpenAPI(m *Manifest, doer openapi.Doer, store ConnectionStore) (Connector, error) {
	p, err := parseAndValidate(m)
	if err != nil {
		return nil, err
	}
	auth, aerr := resolveAuth(p.spec, m.AuthScheme)
	if aerr != nil {
		return nil, fmt.Errorf("connector %q: %w", m.ID, aerr)
	}
	rt, rerr := openapi.NewRuntime(p.spec, p.binding, doer)
	if rerr != nil {
		return nil, fmt.Errorf("connector %q: %w", m.ID, rerr)
	}
	core := &openapiCore{
		runtime: rt, store: store, auth: auth, id: m.ID,
		refresher: buildRefresher(p.spec, m.AuthScheme, doer, store),
	}
	return adaptByCategory(p.binding.Category, core)
}

// parseAndValidate —— 解析 spec + binding，校验自洽。
func parseAndValidate(m *Manifest) (parsed, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return parsed{}, fmt.Errorf("connector %q: %w", m.ID, err)
	}
	binding, berr := openapi.ParseBinding(m.Binding)
	if berr != nil {
		return parsed{}, fmt.Errorf("connector %q: %w", m.ID, berr)
	}
	if verr := binding.ValidateAgainst(spec); verr != nil {
		return parsed{}, fmt.Errorf("connector %q: %w", m.ID, verr)
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
