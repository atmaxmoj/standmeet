// assemble.go —— manifest → 装配好的连接器。归一化的装配入口：内置（仓库里的 spec+binding
// 文件）和上传（owner 在 UI 贴的）走**同一个** Assemble，唯一区别是 manifest 数据哪来。
// 装配 = 解析 spec + binding → 校验自洽 → 建 runtime → 按品类包成对应契约适配器。

package connector

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// Manifest —— 一个连接器的声明（数据，非代码）。openapi: spec+binding；protocol: 由 Protocol
// 字段选内置协议 runtime（P3）。内置与上传同构，只是 Spec/Binding 的来源不同。
type Manifest struct {
	ID       string
	Kind     string
	Category string
	Protocol string
	Spec     []byte
	Binding  []byte
}

// AssembleOpenAPI —— 把一份 openapi manifest 装配成 Connector。解析/校验任一步失败 → 错
// （装配期当场拒，回 admin 友好提示）。返回的具体类型按绑定品类是 calendarAdapter / mailAdapter，
// 二者都既是 Connector 又是对应品类契约（消费侧按品类断言）。
func AssembleOpenAPI(m *Manifest, doer openapi.Doer, auth AuthManager) (Connector, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return nil, fmt.Errorf("connector %q: %w", m.ID, err)
	}
	binding, berr := openapi.ParseBinding(m.Binding)
	if berr != nil {
		return nil, fmt.Errorf("connector %q: %w", m.ID, berr)
	}
	if verr := binding.ValidateAgainst(spec); verr != nil {
		return nil, fmt.Errorf("connector %q: %w", m.ID, verr)
	}
	rt, rerr := openapi.NewRuntime(spec, binding, doer)
	if rerr != nil {
		return nil, fmt.Errorf("connector %q: %w", m.ID, rerr)
	}
	return adaptByCategory(binding.Category, &openapiCore{id: m.ID, runtime: rt, auth: auth})
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
