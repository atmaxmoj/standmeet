// agent_turn_wire.go —— `/agent/turn` 的**线上形状**：浏览器发过来的那份 body。
//
// 跟 AgentTurnInput（这一轮跑起来需要什么，由 route handler 装）分开放:一个是外面给的,
// 一个是里面要的。混在一个文件里时，读的人分不出哪些字段是**调用方能决定的** —— 而这条
// 边界正是安全判断的起点（system 由客户端拼好发回来这件事，就是 F-B-14 的一半）。

package inference

// AgentTurnRequest —— 浏览器 POST body。
//
// system + user_message 拼好直接当 ChatModelAgent 的 instruction +
// user input；history 是上一 turn 之前的对话记录（可能含 assistant
// tool_calls / tool 结果，用 pi unified shape），传给 ADK 当上下文。
//
// ⚠️ System 是**客户端拼的**：`/sessions` 下发 part id + persona，浏览器取文本组好再发回来。
// 也就是说它反映的是**发会话那一刻**的世界。会话中途才成立的事实（额度用完了、连接器掉线了）
// 进不了这个字段 —— 那些走 `AgentTurnInput.SessionNotes`（F-B-14）。
//
// ConversationID —— 持久化的 chat ID (issueSession 时返回的)；backend
// 内部 tool (calendar_book / dialog persist) 用来把当 turn 的产物关
// 联到正确的 conversation 行。老 /sessions/{convID}/tools/{name} wire
// 走 URL path；新 /agent/turn 由 body 透。
type AgentTurnRequest struct {
	DocContext      *AgentDocContext `json:"doc_context,omitempty"`
	System          string           `json:"system"`
	UserMessage     string           `json:"user_message"`
	ConversationID  string           `json:"conversation_id"`
	Model           string           `json:"model,omitempty"`
	VisitorTimezone string           `json:"visitor_timezone,omitempty"`
	History         []ChatRequestMsg `json:"history,omitempty"`
}

// AgentDocContext —— 访客当前所在 document 的最小标识(给指代解析用)。
type AgentDocContext struct {
	Title string `json:"title"`
	Path  string `json:"path"`
	Genre string `json:"genre"` // wiki | output | writing
}
