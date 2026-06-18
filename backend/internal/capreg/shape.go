// shape.go —— Capability 暴露侧枚举。invariants spec 断言：
//   visitor_only ↔ 不出现在 owner MCP
//   owner_only   ↔ 不出现在 visitor session
//   both         ↔ 两侧都出现

package capreg

// Shape —— 一个 capability 暴露给哪一侧。
type Shape string

// Shape 枚举值。
const (
	ShapeVisitorOnly Shape = "visitor_only"
	ShapeOwnerOnly   Shape = "owner_only"
	ShapeBoth        Shape = "both"
)
