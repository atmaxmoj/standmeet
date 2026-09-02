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
// AllowedTools / Needs never go out on the wire (ops has its own outbound shape); they're
// intermediate conclusions within this search pass.
//
// **nil and an empty slice mean different things here**, for both fields:
//   - AllowedTools: nil = this skill's SKILL.md was never read (the SkillsMP source doesn't
//     fetch body text during search); [] = it was read, and it declares no tools.
//   - Needs: nil = can't answer (body wasn't read, or this instance can't parse it); [] =
//     answerable, and it needs no connectors.
//
// Collapsing the two into one empty slice prints "unknown" as "no problem" — the `needs`
// field used to be exactly this permanently-empty (F-F-4).
type MarketSkill struct {
	RepoStars    *int         `json:"repo_stars"`
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Author       string       `json:"author"`
	Version      string       `json:"version"`
	Category     string       `json:"category"`
	Description  string       `json:"description"`
	SourceURL    string       `json:"source_url"`
	Source       MarketSource `json:"source"`
	AllowedTools []string     `json:"-"`
	Needs        []string     `json:"-"`
}

// MarketSkillContent —— parsed SKILL.md (#48-3 install). Prompt is the SKILL.md body (all of
// it after the frontmatter), used as the skill's extra system prompt; name/description/
// allowed-tools come from the frontmatter. Empty fields fall back to search metadata in the
// install usecase.
type MarketSkillContent struct {
	Name         string
	Description  string
	Version      string
	Prompt       string
	AllowedTools []string
}
