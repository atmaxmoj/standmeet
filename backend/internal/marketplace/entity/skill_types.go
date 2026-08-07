// skill_types.go —— marketplace domain value objects. The search proxy fetches GitHub
// `anthropics/skills` + SkillsMP, normalizes into MarketSkill, returns the union; install is a
// separate shipped path (SKILL.md download + frontmatter parse, #48-3).
//
// These live in the marketplace module itself (not the shared domain god-package): the
// aggregation client + install usecase own their own entity types.

package entity

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
// RepoStars is the star count of the REPOSITORY the skill lives in — not of the skill. Skills
// are folders inside a repo, so siblings legitimately share one number; the earlier name `Stars`
// invited the card to present it as this skill's popularity (F-F-2). nil means "not known from
// this source" and must stay distinguishable from zero: the GitHub path has no per-skill figure
// at all, and rendering that as `★ 0` tells the owner this skill has no stars.
type MarketSkill struct {
	RepoStars   *int         `json:"repo_stars"`
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Author      string       `json:"author"`
	Version     string       `json:"version"`
	Category    string       `json:"category"`
	Description string       `json:"description"`
	SourceURL   string       `json:"source_url"`
	Source      MarketSource `json:"source"`
}

// MarketSkillContent —— parsed SKILL.md(#48-3 install)。Prompt 是 SKILL.md 正文
// (frontmatter 之后的全部),作为 skill 的附加 system prompt;name/description/
// allowed-tools 来自 frontmatter。空字段由 install usecase 用搜索元数据兜底。
type MarketSkillContent struct {
	Name         string
	Description  string
	Version      string
	Prompt       string
	AllowedTools []string
}
