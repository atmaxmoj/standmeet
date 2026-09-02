// shape.go —— the enum for which side a Capability is exposed on. The
// invariants spec asserts:
//   visitor_only ↔ never appears in owner MCP
//   owner_only   ↔ never appears in a visitor session
//   both         ↔ appears on both sides

package capreg

// Shape —— which side a capability is exposed to.
type Shape string

// Shape enum values.
const (
	ShapeVisitorOnly Shape = "visitor_only"
	ShapeOwnerOnly   Shape = "owner_only"
	ShapeBoth        Shape = "both"
)
