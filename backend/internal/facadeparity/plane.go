package facadeparity

// Plane —— the trust plane a facade faces (facade-directions.md). Owner-plane facades (admin, MCP)
// serve the authenticated owner; outward-plane facades (chat, api, web) serve granted outsiders,
// scoped by role. An op belongs to exactly one plane; exposing it on a facade of the other plane is
// a leak. PlaneOwner is the zero value so pre-direction manifests/facades stay owner by default.
type Plane int8

// Trust planes: the owner-control side and the outward (granted-outsider) side.
const (
	PlaneOwner Plane = iota
	PlaneOutward
)
