// marketplace.go —— Skill marketplace value objects. The search proxy fetches GitHub
// `anthropics/skills` + SkillsMP, normalizes into MarketSkill, returns the union; install is a
// separate shipped path (see below).
//
// SKILL.md download + frontmatter parse + persistent install shipped (#48-3): the frontend POSTs to
// the real /marketplace/install and the backend fetches + parses the SKILL.md server-side.
// Nothing is simulated in client state anymore.

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
