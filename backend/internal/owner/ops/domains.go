// Package ops —— owner 域对外能做的事,由域自己声明。
//
// 一个操作在这里是完整的一份:id、说明、入参 schema、语义类别、暴露意图、实现。
// 实现直接调本域的用例,不经中间形状 —— 收口只汇聚、加装饰器、投影到各个面。
package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Domains —— on-demand TLS 的自定义域名白名单:列出 / 加 / 删。
//
// 真正的 DNS / TLS 验证走 Caddy 的 on-demand 回调,这里只维护那份名单。
// 它是**实例级**设置(单 owner 实例),所以域函数不吃 ownerID —— 这一层把它吃掉,
// 让收口那侧每个操作的签名一致。
func Domains(deps usecase.AllowedDomainsDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "domains.list",
			Description: "List the custom domains allowed for on-demand TLS.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listDomains(deps),
		},
		{
			ID: "domains.add",
			Description: "Allow a custom domain for on-demand TLS. Scheme and trailing " +
				"slash are normalized off.",
			InputSchema: domainSchema("Domain to allow, e.g. me.example.com"),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mutateDomain(deps, usecase.AddAllowedDomain),
		},
		{
			ID:          "domains.remove",
			Description: "Stop allowing a custom domain. Idempotent.",
			InputSchema: domainSchema("Domain to remove."),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mutateDomain(deps, usecase.RemoveAllowedDomain),
		},
	}
}

var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// nonNilStrings —— nil 切片序列化成 null,调用方要的是 []。
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func domainSchema(desc string) json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{"domain":{"type":"string","description":"` + desc + `"}},
		"required":["domain"]
	}`)
}

type domainArgs struct {
	Domain string `json:"domain"`
}

func listDomains(deps usecase.AllowedDomainsDeps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := usecase.ListAllowedDomains(ctx, deps)
		if err != nil {
			return nil, fp.OpErr("list allowed domains", err)
		}
		return json.Marshal(map[string][]string{"domains": list})
	}
}

// mutateDomain —— 加和删只差调哪个用例;解参、校验、回包形状同一份。
func mutateDomain(
	deps usecase.AllowedDomainsDeps,
	apply func(ctx context.Context, deps usecase.AllowedDomainsDeps, domain string) error,
) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in domainArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"domain", in.Domain}); err != nil {
			return nil, err
		}
		if err := apply(ctx, deps, in.Domain); err != nil {
			return nil, domainErr(err)
		}
		return json.Marshal(in)
	}
}

// domainErr —— 域说"这个字段空"(normalize 之后才变空也算),对外就是调用方给错了。
func domainErr(err error) error {
	if errors.Is(err, apierr.ErrEmptyField) {
		return fp.BadInput("domain is required")
	}
	return fp.OpErr("mutate allowed domain", err)
}
