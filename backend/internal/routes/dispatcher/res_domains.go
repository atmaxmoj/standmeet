// res_domains.go —— 资源 domains:on-demand TLS 的自定义域名白名单。
//
// 真正的 DNS / TLS 验证走 /internal/tls-ask(Caddy 的 on-demand TLS 回调),这里只维护
// instance_settings.allowed_domains 那个 jsonb 数组。
//
// 跟 ip_bans 一样:业务在 owner 域的普通函数上,这一层只解参、调、序列化。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// AllowedDomainStore —— domains 这组操作所需的最小口。
type AllowedDomainStore interface {
	List(ctx context.Context, ownerID string) ([]string, error)
	Add(ctx context.Context, ownerID, domain string) error
	Remove(ctx context.Context, ownerID, domain string) error
}

// Domains —— domains 资源:list / add / remove。
func Domains(store AllowedDomainStore) Resource {
	return Resource{Name: "domains", Ops: []Op{
		{
			ID:          "domains.list",
			Description: "List the custom domains allowed for on-demand TLS.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      domainsList(store),
		},
		{
			ID: "domains.add",
			Description: "Add a custom domain to the on-demand TLS whitelist. " +
				"scheme + trailing slash are normalized off.",
			InputSchema: domainArgSchema("Domain to allow, e.g. me.example.com"),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      domainsMutate(store.Add),
		},
		{
			ID:          "domains.remove",
			Description: "Remove a custom domain from the on-demand TLS whitelist. Idempotent.",
			InputSchema: domainArgSchema("Domain to remove."),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      domainsMutate(store.Remove),
		},
	}}
}

func domainArgSchema(desc string) json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{"domain":{"type":"string","description":"` + desc + `"}},
		"required":["domain"]
	}`)
}

type domainArgs struct {
	Domain string `json:"domain"`
}

func domainsList(store AllowedDomainStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list allowed domains: %w", err)
		}
		return marshalOut(map[string][]string{"domains": list})
	}
}

// domainsMutate —— add / remove 只差调哪个函数,入参校验和回包形状是同一份。
func domainsMutate(apply func(ctx context.Context, ownerID, domain string) error) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in domainArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.Domain == "" {
			return nil, BadInput("domain is required")
		}
		if err := apply(ctx, ownerID, in.Domain); err != nil {
			return nil, fmt.Errorf("mutate allowed domain: %w", err)
		}
		return marshalOut(domainArgs{Domain: in.Domain})
	}
}
