// res_ip_bans.go —— 资源 ip_bans 的操作声明(第一条打通端到端的样板)。
//
// 注意这里做的是**适配**,不是业务:业务在 security 域的 facade 上,是普通函数
// (List / Ban / Unban),它完全不知道自己会被 MCP 还是 HTTP 服务。这一层只做三件事:
// 解 args JSON、调域函数、把结果序列化。协议特有的东西(MCP 的 isError、HTTP 的状态码)
// 由各个面自己翻译。
//
// 载荷形状即**契约**:两个面拿到的是同一份 JSON。admin 上已经发出去的形状
// (expires_at 可为 null、reason 常在、删除回 {"ok":true})就是这份契约,所以它写在这儿一次,
// MCP 面跟着拿到同样的东西 —— 而不是两个面各编一套。
//
// 每个 Op 的 Reach 是**意图**:这几个都是 owner 的读/写动作,所以任何能承载 owner 动作的面
// 都欠它们 —— 新加一个面时,对账立刻把这笔账列出来。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// IPBanStore —— 声明 ip_bans 这组操作所需的最小仓储口(security 的 BannedIPRepo 天然满足)。
// 用窄接口而不是直接吃 repo:收口只需要这三个动作,不该顺带握住整个仓储。
type IPBanStore interface {
	List(ctx context.Context, ownerID string) ([]IPBan, error)
	Ban(ctx context.Context, in *BanIP) (IPBan, error)
	Unban(ctx context.Context, ownerID, id string) error
}

// IPBan —— 一条封禁在收口这一层的形状(不引 security 的类型,免得协议层跟域实体绑死)。
type IPBan struct {
	ExpiresAt *time.Time
	CreatedAt time.Time
	ID        string
	IP        string
	Reason    string
}

// BanIP —— 封一个 IP 的入参(打包成结构体,免得参数个数越界)。
type BanIP struct {
	ExpiresAt *time.Time
	OwnerID   string
	IP        string
	Reason    string
}

// IPBans —— ip_bans 资源:list / add / remove。
func IPBans(store IPBanStore) Resource {
	return Resource{Name: "ip_bans", Ops: []Op{
		{
			ID:          "ip_bans.list",
			Description: "List all IPs the owner has banned (includes expired ones).",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      ipBansList(store),
		},
		{
			ID:          "ip_bans.add",
			Description: "Ban a source IP. Upserts (re-banning the same IP overwrites).",
			InputSchema: ipBanAddSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      ipBansAdd(store),
		},
		{
			ID:          "ip_bans.remove",
			Description: "Unban a previously banned IP by its ban id. Idempotent.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"id":{"type":"string","description":"Ban row id."}},
				"required":["id"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: ipBansRemove(store),
		},
	}}
}

var ipBanAddSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"ip":{"type":"string","description":"Source IP to ban."},
		"reason":{"type":"string","description":"Optional note on why."},
		"expires_at":{"type":"string",
			"description":"Optional RFC3339 expiry. Empty = permanent."}
	},
	"required":["ip"]
}`)

// ipBanRow —— 出站载荷形状。expires_at 用指针(永久封禁 = null,而不是字段消失),
// time.Time 本身就按 RFC3339 序列化。
type ipBanRow struct {
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
	ID        string     `json:"id"`
	IP        string     `json:"ip"`
	Reason    string     `json:"reason"`
}

func toIPBanRow(b *IPBan) ipBanRow {
	return ipBanRow{
		ID: b.ID, IP: b.IP, Reason: b.Reason,
		CreatedAt: b.CreatedAt, ExpiresAt: b.ExpiresAt,
	}
}

func ipBansList(store IPBanStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		bans, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list ip bans: %w", err)
		}
		out := make([]ipBanRow, 0, len(bans))
		for i := range bans {
			out = append(out, toIPBanRow(&bans[i]))
		}
		return marshalOut(out)
	}
}

type ipBanAddArgs struct {
	IP        string `json:"ip"`
	Reason    string `json:"reason"`
	ExpiresAt string `json:"expires_at"`
}

// parseIPBanAdd —— 解 + 校验入参(拆出来让 Invoke 本体只剩"调域函数 + 序列化")。
// 校验只此一处:两个面都从这儿过,不会出现 admin 校验了、MCP 忘了这种偏差。
func parseIPBanAdd(ownerID string, raw json.RawMessage) (*BanIP, error) {
	var in ipBanAddArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, BadInput("invalid arguments: " + err.Error())
	}
	if in.IP == "" {
		return nil, BadInput("ip is required")
	}
	out := &BanIP{OwnerID: ownerID, IP: in.IP, Reason: in.Reason}
	if in.ExpiresAt == "" {
		return out, nil
	}
	t, perr := time.Parse(time.RFC3339, in.ExpiresAt)
	if perr != nil {
		return nil, BadInput("expires_at must be RFC3339 or empty")
	}
	out.ExpiresAt = &t
	return out, nil
}

func ipBansAdd(store IPBanStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseIPBanAdd(ownerID, raw)
		if perr != nil {
			return nil, perr
		}
		ban, err := store.Ban(ctx, args)
		if err != nil {
			return nil, fmt.Errorf("ban ip: %w", err)
		}
		row := toIPBanRow(&ban)
		return marshalOut(row)
	}
}

type ipBanRemoveArgs struct {
	ID string `json:"id"`
}

func ipBansRemove(store IPBanStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in ipBanRemoveArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.ID == "" {
			return nil, BadInput("id is required")
		}
		if err := store.Unban(ctx, ownerID, in.ID); err != nil {
			return nil, fmt.Errorf("unban ip: %w", err)
		}
		return marshalOut(map[string]bool{"ok": true})
	}
}
