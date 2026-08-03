// skills_seed.go —— builtin skill 种子。owner claim 时调一次；server 启动也
// 跑一次（idempotent UPSERT by owner_id+name 让 prompt 更新能落地）。
//
// 种子 prompts 来自 legacy standmeet-server/backend/iam/seed_builtin_skills.py，
// 字字对齐。owner 可在 admin UI 创建自己的 skill；builtin 不可删（repo
// DeleteSkill 加了 is_builtin=false 谓词）。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/marketplace/repo"
)

// SeedBuiltinSkills —— 对一个 owner 幂等 upsert 全部 builtin skills。
func SeedBuiltinSkills(ctx context.Context, repo *repo.SkillRepo, ownerID string) error {
	for i := range builtinSkillSeeds {
		s := &builtinSkillSeeds[i]
		if _, err := repo.UpsertBuiltin(ctx, ownerID, s.Name, s.Description, s.Prompt); err != nil {
			return fmt.Errorf("upsert builtin skill %q: %w", s.Name, err)
		}
	}
	return nil
}

type builtinSkillSeed struct {
	Name        string
	Description string
	Prompt      string
}

// builtinSkillSeeds —— 5 个 hand-curated builtin skills，源自 legacy。
// Conversation Report 跟 visitor_summary.go 的 summaryPrompt 共享同一段文案
// （/summary 走 hardcoded 路径，这里给 owner 看 + 也可绑到普通 invite）。
var builtinSkillSeeds = []builtinSkillSeed{
	{
		Name:        "code-review",
		Description: "Review code snippets the visitor pastes; flag bugs and design issues.",
		Prompt: "When the visitor pastes code, act as a senior code reviewer. Identify:\n" +
			"  1. correctness bugs (off-by-one, nil deref, concurrency, etc.);\n" +
			"  2. design issues (missing abstractions, leaky interfaces);\n" +
			"  3. readability / naming;\n" +
			"  4. test gaps.\n\n" +
			"Prefer concrete suggestions over generic advice. Quote the specific lines you " +
			"are flagging. If the snippet is too short to judge, ask for the surrounding context " +
			"before guessing.",
	},
	{
		Name:        "frontend-design",
		Description: "Critique frontend / UI design submissions; reference owner's design taste.",
		Prompt: "Visitors may share UI screenshots, mockups, or component code. Critique them " +
			"through the lens of the owner's design taste (read owner's wiki under " +
			"`projects/` and `design/` paths via corpus_search first if you don't " +
			"already know it).\n\n" +
			"Focus areas: visual hierarchy, type, spacing, color contrast, anti-patterns. " +
			"Reference concrete prior work the owner has done when you can.",
	},
	{
		Name:        "resume-portfolio",
		Description: "Discuss the owner's resume / portfolio / past projects with recruiters.",
		Prompt: "When the visitor is a recruiter / hiring manager, your job is to surface the " +
			"owner's most relevant past work for the role they describe.\n\n" +
			"Use corpus_list + corpus_read to walk the `projects/` and " +
			"`resume/` paths. Quote owner's own words verbatim where possible. " +
			"Never invent achievements the corpus doesn't back. If asked something the " +
			"corpus doesn't cover, say so clearly rather than fabricating.",
	},
	{
		Name:        "technical-interview",
		Description: "Run a mock technical interview, in the owner's style and seniority bar.",
		Prompt: "Run a structured technical interview: open with a warm-up, dig into one " +
			"system-design and one coding problem, end with a candidate Q&A slot.\n\n" +
			"Calibrate difficulty to the role the visitor mentions. Push back with specifics " +
			"(complexity bounds, failure modes, edge cases) — never accept hand-wavy answers. " +
			"At the end give a written verdict (hire / no-hire) with specific strengths + gaps.",
	},
	{
		Name:        "conversation-report",
		Description: "Generate the post-session Markdown summary report (used by /summary).",
		Prompt: "Generate a polished conversation report (max 600 words, " +
			"1-2 printed pages).\n\n" +
			"Use proper Markdown formatting — the output will be rendered with a full " +
			"Markdown engine (headings, bold, lists, tables, blockquotes, etc. all work).\n\n" +
			"## Required sections:\n\n" +
			"### Overview\n2-3 sentences summarizing the conversation topic and outcome.\n\n" +
			"### Key Topics Discussed\n3-5 bullet points. Each bullet should be a concise " +
			"sentence, not just a keyword.\n\n" +
			"### Key Takeaways\n3-5 bullet points of the most important findings.\n\n" +
			"### Next Steps\nIf applicable, 2-3 actionable recommendations. Omit this section " +
			"if nothing actionable.\n\n" +
			"## Formatting rules:\n" +
			"- Use `##` for section headings (NOT `#` or `###`)\n" +
			"- Use `-` for bullet points\n" +
			"- Use **bold** for emphasis on key terms\n" +
			"- Keep paragraphs short (2-3 sentences max)\n" +
			"- Do NOT reproduce the conversation transcript\n" +
			"- Write in third person (\"The visitor asked about...\", " +
			"\"The discussion covered...\")\n" +
			"- Professional tone, suitable for sharing",
	},
}
