// marketplace.go —— Skill marketplace value objects. v1 surface is a
// search-only proxy: backend fetches GitHub `anthropics/skills` repo +
// SkillsMP HTTP API, normalizes into MarketSkill, returns the union.
//
// SKILL.md download + frontmatter parse + persistent install land in a
// later phase; for now the frontend simulates install in client state.

package domain

// MarketSource —— marketplace origin a skill came from. Stable string
// values both sides serialize.
type MarketSource string

// MarketSource enumerated values.
const (
	// MarketSourceGitHub —— anthropics/skills GitHub repo (any fork+PR welcome).
	MarketSourceGitHub MarketSource = "github"
	// MarketSourceSkillsMP —— SkillsMP commercial marketplace.
	MarketSourceSkillsMP MarketSource = "skillsmp"
)

// MarketSkill —— normalized search result entry.
//
// `SourceURL` is canonical: `github.com/anthropics/skills/<id>` or
// `skillsmp.com/skills/<id>`. The backend doesn't link out to it; the
// frontend renders it as plain monospace text.
//
// Field order packs the GC-scannable pointers (strings) before the
// non-pointer Stars (int) so fieldalignment sees a smaller scan window.
type MarketSkill struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Author      string       `json:"author"`
	Version     string       `json:"version"`
	Category    string       `json:"category"`
	Description string       `json:"description"`
	SourceURL   string       `json:"source_url"`
	Source      MarketSource `json:"source"`
	Stars       int          `json:"stars"`
}
