// Package marketplace -- external facade for the marketplace domain (MCP servers + skills
// a role can mount). A thin layer: it lifts types/constructors/usecases from internal
// sibling packages so other layers only import this facade package. The implementation
// lives in sibling packages internal/marketplace/{entity,repo,usecase,db}; direct outside
// imports of those are blocked by check-domain-facade-boundary.
//
// # External contract
//
//   - entity: Skill / MCPServerConfig / MarketSkill (+ Source/Content); Err* domain errors
//   - repo: SkillRepo / MCPServerRepo + Create* input types
//   - usecase: skill / mcp-server CRUD + seed + marketplace fetch (github / skills.mp clients)
package marketplace
