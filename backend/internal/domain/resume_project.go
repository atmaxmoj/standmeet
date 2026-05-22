// resume_project.go —— ResumeProject (STAR) + ResumeEducation + ResumeSkillSet。
// 拆出来让 resume.go 控制在 5 public types 以内。

package domain

// ResumeProject —— STAR-shaped project entry。Situation / Task / Action /
// Result + 可选 Supplementary（tech stack / metric）。
type ResumeProject struct {
	Name          string `json:"name"`
	Situation     string `json:"situation"`
	Task          string `json:"task"`
	Action        string `json:"action"`
	Result        string `json:"result"`
	Supplementary string `json:"supplementary,omitempty"`
}

// ResumeEducation —— 一段教育经历。
type ResumeEducation struct {
	Period ResumePeriod `json:"period"`
	School string       `json:"school"`
	Degree string       `json:"degree"`
}

// ResumeSkillSet —— 一组同 category 技能。
type ResumeSkillSet struct {
	Category string   `json:"category"`
	Items    []string `json:"items"`
}
