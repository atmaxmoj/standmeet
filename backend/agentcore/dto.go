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
	// GrantedCapabilities — which capabilities (capability id) this run's role has granted.
	//
	// acl=always capabilities (ask_visitor / retrieval) don't consult this; acl=role_granted
	// ones (booker / third-party servers) **must** appear here to be exposed — the exact
	// same gate as prod: no grant from the role, no tool. So the assertion "an ungranted
	// run structurally lacks the tool" is testing the real gate in eval, not "this run
	// just happened not to mount it".
	GrantedCapabilities []string
}
