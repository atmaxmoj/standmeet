// resume.go —— Resume value object: Claude 通过 MCP `resume.draft` 撰写的
// 结构化简历内容。**不进 owner aggregate** —— 每条 resume 绑一份
// application（Phase 3）或一个 draft（这里 Phase 2）。
//
// Shape 跟 design/admin.html 的 ResumePage 对齐（两栏 editorial layout）：
//   - identity / summary / experience（bullets，无 STAR labels）
//   - education / skills（左 rail）
//   - social[] / custom[] / cover_letter（design 新加的字段）
//
// json tags 是 Redis + jsonb persistence 用。
//
// 字段顺序按 govet fieldalignment：slice / map 先（含 ptr），time / strings 后。

package domain

// ResumeContent —— 一份简历的完整结构化内容。
type ResumeContent struct {
	Identity    ResumeIdentity    `json:"identity"`
	Summary     string            `json:"summary"`
	CoverLetter string            `json:"cover_letter,omitempty"`
	Works       []ResumeWork      `json:"works"`
	Educations  []ResumeEducation `json:"educations"`
	Skills      []ResumeSkillSet  `json:"skills"`
	Social      []ResumeSocial    `json:"social,omitempty"`
	Custom      []ResumeCustom    `json:"custom,omitempty"`
}

// ResumeIdentity —— 身份块（identity 段在 Claude 重写时几乎不变；改变
// 时是 owner 自己刷新 corpus）。
type ResumeIdentity struct {
	Name         string       `json:"name"`
	Email        string       `json:"email"`
	Phone        string       `json:"phone"`
	LocationLine string       `json:"location_line"`
	Site         string       `json:"site,omitempty"` // public_url 短形式，header 行末尾显示
	Links        []ResumeLink `json:"links"`
}

// ResumeLink —— identity 段的 outbound 链接（保留兼容；新数据走 Social）。
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
