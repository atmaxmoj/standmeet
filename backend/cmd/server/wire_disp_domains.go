// wire_disp_domains.go —— owner 的 allowed-domains 普通函数 → 出站收口的窄口。

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// domainOps —— owner 的 allowed-domains 普通函数 → 收口要的窄口。
//
// 这几个函数是 instance 级设置(单 owner 实例),不吃 ownerID —— 适配器把它吃掉,
// 收口那一侧的签名对所有资源保持一致。
type domainOps struct{ deps owner.AllowedDomainsDeps }

func newDomainOps(d *runtimeDeps) domainOps {
	return domainOps{deps: owner.AllowedDomainsDeps{Instance: d.instanceRepo}}
}

func (a domainOps) List(ctx context.Context, _ string) ([]string, error) {
	list, err := owner.ListAllowedDomains(ctx, a.deps)
	if err != nil {
		return nil, fmt.Errorf("list allowed domains: %w", err)
	}
	return list, nil
}

func (a domainOps) Add(ctx context.Context, _, domain string) error {
	return domainErr(owner.AddAllowedDomain(ctx, a.deps, domain))
}

func (a domainOps) Remove(ctx context.Context, _, domain string) error {
	return domainErr(owner.RemoveAllowedDomain(ctx, a.deps, domain))
}

// domainErr —— 域说"这个字段空"(normalize 之后可能才变空),对外就是调用方给错了。
// 翻译落在组装根:收口不 import apierr,域不认识 HTTP 状态码。
func domainErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, apierr.ErrEmptyField) {
		//nolint:wrapcheck // BadInput 就是要原样上抛:包一层会让面认不出这是调用方的错
		return dispatcher.BadInput("domain is required")
	}
	return fmt.Errorf("mutate allowed domain: %w", err)
}
