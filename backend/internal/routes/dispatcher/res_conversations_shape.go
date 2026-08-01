// res_conversations_shape.go —— 对话的出站载荷形状(两个面同一份)。
//
// 形状在收口这边,不在组装根:它是**两个面共享的契约**。组装根只把域实体映射成这些类型,
// 改形状必须改这里 —— 收口看得见。
//
// 合并前:面板那份带 refs(标题 + 地址)和 ghost 日志、MCP 那份带被引条目的**正文**
// (owner 拿它 debug 检索),谁也不是谁的子集;列表里的 code_id / code_value / client_ip
// 也只有面板有。现在一份。

package dispatcher

// Conversation —— 对话列表里的一行。
type Conversation struct {
	CodeID      *string `json:"code_id,omitempty"`
	CodeLabel   *string `json:"code_label,omitempty"`
	CodeValue   *string `json:"code_value,omitempty"`
	StartedAt   string  `json:"started_at"`
	LastAt      string  `json:"last_at"`
	ID          string  `json:"id"`
	Mode        string  `json:"mode"`
	VisitorName string  `json:"visitor_name"`
	Sentiment   string  `json:"sentiment"`
	ClientIP    string  `json:"client_ip"`
	Turns       int32   `json:"turns"`
	PrivateHits int32   `json:"private_hits"`
}

// TranscriptMessage —— 逐字稿里的一条消息,连同它引了哪些条目。
type TranscriptMessage struct {
	CreatedAt            string   `json:"created_at"`
	ID                   string   `json:"id"`
	Role                 string   `json:"role"`
	Body                 string   `json:"body"`
	CitedWikiIDs         []string `json:"cited_wiki_ids"`
	CitedWritingIDs      []string `json:"cited_writing_ids"`
	CitedOutputIDs       []string `json:"cited_output_ids"`
	CitedSubjectivityIDs []string `json:"cited_subjectivity_ids"`
}

// CitedRef —— 一条被引条目。Body 是 owner debug 检索时最想看的那半边(以前只有 MCP 有);
// 取不到就是空串 —— 一条引用读不出正文,不该让整份逐字稿失败。
type CitedRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
	Body  string `json:"body"`
}

// GhostShown —— 给这次对话打过的一条 ghost 提示,以及访客有没有接。
type GhostShown struct {
	AcceptedAt *string `json:"accepted_at,omitempty"`
	ID         string  `json:"id"`
	GhostText  string  `json:"ghost_text"`
	Source     string  `json:"source"`
	ShownAt    string  `json:"shown_at"`
	TurnIndex  int32   `json:"turn_index"`
	Accepted   bool    `json:"accepted"`
}

// Transcript —— 一整份逐字稿。
type Transcript struct {
	Conversation     Conversation        `json:"conversation"`
	Messages         []TranscriptMessage `json:"messages"`
	WikiRefs         []CitedRef          `json:"wiki_refs"`
	WritingRefs      []CitedRef          `json:"writing_refs"`
	OutputRefs       []CitedRef          `json:"output_refs"`
	SubjectivityRefs []CitedRef          `json:"subjectivity_refs"`
	Ghosts           []GhostShown        `json:"ghosts"`
}
