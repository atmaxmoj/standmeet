// resume.go —— Resume value object: Claude 通过 MCP `resume.draft` 撰写的
// 结构化简历内容。**不进 owner aggregate** —— 每条 resume 绑一份
// application（Phase 3）或一个 draft（这里 Phase 2）。
//
// Shape 借 interviewme 的 STAR project 设计（见 docs/design/job-loop.md
// "resume_content shape"）。json tags 是 Redis + jsonb persistence 用。
//
// 字段顺序按 govet fieldalignment：slice / map 先（含 ptr），time / strings 后。

package domain

// ResumeContent —— 一份简历的完整结构化内容。
type ResumeContent struct {
	Identity   ResumeIdentity    `json:"identity"`
	Summary    string            `json:"summary"`
	Works      []ResumeWork      `json:"works"`
	Projects   []ResumeProject   `json:"projects"`
	Educations []ResumeEducation `json:"educations"`
	Skills     []ResumeSkillSet  `json:"skills"`
}

// ResumeIdentity —— 身份块（identity 段在 Claude 重写时几乎不变；改变
// 时是 owner 自己刷新 corpus）。
type ResumeIdentity struct {
	Name         string       `json:"name"`
	Email        string       `json:"email"`
	Phone        string       `json:"phone"`
	LocationLine string       `json:"location_line"`
	Links        []ResumeLink `json:"links"`
}

// ResumeLink —— identity 段的 outbound 链接（github / personal site / linkedin...）。
type ResumeLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// ResumePeriod —— start/end 月份（YYYY-MM）；End 为 nil 时 "Present"。
type ResumePeriod struct {
	End   *string `json:"end,omitempty"`
	Start string  `json:"start"`
}

// ResumeWork —— 一段工作经历（带按 JD 排序好的 bullets）。
type ResumeWork struct {
	Period   ResumePeriod `json:"period"`
	Title    string       `json:"title"`
	Company  string       `json:"company"`
	Location string       `json:"location"`
	Bullets  []string     `json:"bullets"`
}
