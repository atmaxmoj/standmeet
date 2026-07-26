// resume_project.go —— ResumeEducation + ResumeSkillSet。STAR project 段
// 已从 design 中移除（design admin.js ResumePage 只渲 experience，不渲
// projects）。保留这个文件是为了让 ResumeContent 字段定义分散在两个 file
// 不致超 lint 行数；rename 不动以减少 import 改动。

package jobsmodel

// ResumeEducation —— 一段教育经历。
type ResumeEducation struct {
	Period ResumePeriod `json:"period"`
	School string       `json:"school"`
	Degree string       `json:"degree"`
}

// ResumeSkillSet —— 一组同 category 技能。design 把 skills 渲在左 rail，
// 单行 "category: item1, item2" 简化输出；Items 可以为空（只显 category）。
type ResumeSkillSet struct {
	Category string   `json:"category"`
	Items    []string `json:"items"`
}

// ResumeSocial —— 公开 social 资料（recruiter 可验证）。
//
// Kind 取值是 enum-ish 但不强约束（owner 想加 mastodon / bluesky / 任意
// platform 都行）。Label 缺省回退到 Kind。Handle 可以是 url 或 @handle。
type ResumeSocial struct {
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Handle string `json:"handle"`
}

// ResumeCustom —— 左 rail 自定义字段（languages / certifications /
// "I read Kafka in German" 之类杂项）。Label : Value，渲染在 skills 下方。
type ResumeCustom struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
