// dto.go —— the public plain-data types a Driver exchanges with the agent core. Split
// out of driver.go to keep each file's public-struct count within the lint budget.
// These carry no behaviour and no internal/ types, so a separate module (eval-harness)
// constructs them freely when implementing Driver.

package agentcore

// VisitorCorpusEntry —— one curated corpus entry. Genre is "wiki" or "output". Private
// entries are withheld at the retrieval ACL layer (code-level, not prompt).
type VisitorCorpusEntry struct {
	Genre   string
	Path    string
	Title   string
	Body    string
	Tags    []string
	Private bool
}

// VisitorSkillSpec —— a granted owner skill the agent can call. Stdout is the canned
// output RunSkill returns for it in eval (a real sandbox would produce it).
type VisitorSkillSpec struct {
	Name        string
	Description string
	Prompt      string
	Language    string // python | bash | javascript
	Content     string // script source
	Stdout      string // canned stdout the eval Driver returns from RunSkill
	Params      []VisitorSkillParam
}

// VisitorSkillParam —— one input parameter of the skill script's tool schema.
type VisitorSkillParam struct {
	Name        string
	Type        string
	Description string
	Required    bool
}

// LaunchInput —— the per-launch CONTEXT (not environment): who/what frames this run.
// The environment (persona/skill/mcp/cred) comes from the Driver; this is the framing
// the consumer sets. SystemPromptOverride is the prompt-experiment injection point:
// empty → faithful composed prompt; set → use the variant verbatim.
type LaunchInput struct {
	OwnerID              string
	Mode                 string
	ConversationID       string
	CodeID               string
	SystemPromptOverride string
	// GrantedCapabilities —— 这一场的 role 授了哪些能力(capability id)。
	//
	// acl=always 的能力(ask_visitor / 检索)不看它;acl=role_granted 的(booker / 第三方
	// server)**必须**在这儿出现才暴露 —— 跟 prod 一模一样的门:role 没授就没有那个工具。
	// 所以"没授权的场次工具结构性缺席"这条断言在 eval 里测的是真门,不是"这一场恰好没挂"。
	GrantedCapabilities []string
}
