// origin.go —— Phase H / P.5：每个注册的 capability 带一个 Origin（来源），
// 管理面据此分组 + 决定可删性，迁移期 ListByOrigin(builtin) 数还剩几个内建没
// 迁出去。Origin 在 Register 时定（默认 builtin）；插件发现的走 managed，
// owner 自己 author 的走 owner。

package capreg

// Origin —— capability 的来源。决定管理面徽章 + 删除入口（P.6：存在性由
// Origin 控；只有 owner-origin 可删）。
type Origin string

const (
	// OriginBuiltin —— 随产品发的内建能力（corpus.retrieval / calendar.book …）。
	// 可关不可删（P.7）。
	OriginBuiltin Origin = "builtin"
	// OriginManaged —— 平台托管的集成/连接器类型（Google Calendar / SMTP）。
	// 可关不可删；删 = 断开连接，不是删能力。
	OriginManaged Origin = "managed"
	// OriginOwner —— owner 自己 author 的（skill / 注册的 MCP server）。可删。
	OriginOwner Origin = "owner"
)

// Deletable —— 仅 owner-origin 可删（P.6）。
func (o Origin) Deletable() bool { return o == OriginOwner }
