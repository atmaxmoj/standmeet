// descriptor.go — the shape of manifest.yaml.
//
// It and mcpplugin.Manifest are **two different things**: this side is the on-disk
// spelling (YAML tags, optional fields, JSON Schema written verbatim as a block
// scalar), that side is the shape the host uses. The translation between the two
// happens in loader.go, and only there.

package capabilities

import (
	"fmt"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// descriptor — the complete declaration of one capability.
type descriptor struct {
	Transport    transportDesc     `yaml:"transport"`
	Quota        quotaDesc         `yaml:"quota"`
	ClaimGate    claimGateDesc     `yaml:"claim_gate"`
	ID           string            `yaml:"id"`
	Title        string            `yaml:"title"`
	Version      string            `yaml:"version"`
	Shape        string            `yaml:"shape"`
	ACL          string            `yaml:"acl"`
	Requires     []string          `yaml:"requires"`
	VisitorTools []visitorToolDesc `yaml:"visitor_tools"`
	OwnerTools   []ownerToolDesc   `yaml:"owner_tools"`
	Config       []fieldDesc       `yaml:"config"`
	CodeConfig   []fieldDesc       `yaml:"code_config"`
	RoleConfig   []fieldDesc       `yaml:"role_config"`
	RawToolNames bool              `yaml:"raw_tool_names"`
}

// visitorToolDesc — one entry of `visitor_tools`. **Both spellings are accepted**:
//
//	visitor_tools:
//	  - calendar_list_slots            # a capability-level requires is enough (read is fine)
//	  - name: calendar_book            # this one action needs something extra
//	    requires: [calendar:events.insert]
//
// Why the per-tool layer exists (F-B-8 ⭐⭐): a capability-level `requires: [calendar]`
// can only answer "connected or not". When the owner grants only `calendar.readonly`,
// connecting is fine and listing slots is fine — **only writes must always 403** — yet
// the product still offers "book a meeting" to the visitor. Moving the whole requires
// onto the write permission would **hide listing slots along with it**, which removes
// an action that already works. So the granularity has to land on the tool, matching
// what the product already does for email: the confirmation-email part doesn't
// render, but the booking itself still goes through.
type visitorToolDesc struct {
	Name     string   `yaml:"name"`
	Requires []string `yaml:"requires"`
}

// UnmarshalYAML — a bare string = name only; a mapping = name + this one tool's
// extra requires. Both spellings are accepted so the other 4 capabilities'
// manifests stay **untouched**: their visitor_tools are all bare names, and
// "might as well convert them to mappings too" would turn a mechanism patch into
// a repo-wide rewrite ([[externalize-is-not-relocate]] in reverse: what's wanted
// here is exactly add-the-mechanism-without-moving-anything).
func (v *visitorToolDesc) UnmarshalYAML(value *yaml.Node) error {
	if value.Kind == yaml.ScalarNode {
		v.Requires = nil
		if err := value.Decode(&v.Name); err != nil {
			return fmt.Errorf("visitor_tools: %w", err)
		}
		return nil
	}
	type raw struct {
		Name     string   `yaml:"name"`
		Requires []string `yaml:"requires"`
	}
	var r raw
	if err := value.Decode(&r); err != nil {
		return fmt.Errorf("visitor_tools entry: %w", err)
	}
	v.Name, v.Requires = r.Name, r.Requires
	return nil
}

// transportDesc — how to run this capability.
type transportDesc struct {
	Env     map[string]string `yaml:"env"`
	Headers map[string]string `yaml:"headers"`
	Sandbox *sandboxDesc      `yaml:"sandbox"`
	Kind    string            `yaml:"kind"`
	Command string            `yaml:"command"`
	URL     string            `yaml:"url"`
	Args    []string          `yaml:"args"`
}

// sandboxDesc — the isolation declaration. **No socket-path field** — the path is
// derived from the id, and the loader injects it.
type sandboxDesc struct {
	PluginDir string   `yaml:"plugin_dir"`
	HostOps   []string `yaml:"host_ops"`
	AllowNet  bool     `yaml:"allow_net"`
	Workspace bool     `yaml:"workspace"`
}

// ownerToolDesc — one owner-facing tool. input_schema is JSON Schema, written as
// literal JSON.
type ownerToolDesc struct {
	Name        string `yaml:"name"`
	Tool        string `yaml:"tool"`
	Description string `yaml:"description"`
	InputSchema string `yaml:"input_schema"`
}

// fieldDesc — one config item (the owner-facing side and the code-side share this
// same shape).
type fieldDesc struct {
	Min         *int   `yaml:"min"`
	Max         *int   `yaml:"max"`
	Key         string `yaml:"key"`
	Label       string `yaml:"label"`
	Type        string `yaml:"type"`
	Description string `yaml:"description"`
	Default     string `yaml:"default"`
}

// quotaDesc — the three fields for a per-**subject** usage cap. Incomplete → no
// gating (when the host can't count usage, "don't gate" beats "gate blindly").
// The subject can be an access code, or an outward-facing API key (F-B-11).
type quotaDesc struct {
	ConfigKey    string `yaml:"config_key"`
	Collection   string `yaml:"collection"`
	SubjectField string `yaml:"subject_field"`
}

// manifest — only produces a declaration once all three fields are filled in;
// a capability that never declared quota gets nil.
func (q quotaDesc) manifest() *mcpplugin.QuotaDecl {
	decl := &mcpplugin.QuotaDecl{
		ConfigKey: q.ConfigKey, Collection: q.Collection, SubjectField: q.SubjectField,
	}
	if !decl.Usable() {
		return nil
	}
	return decl
}

// claimGateDesc — the two fields behind "say it, then do it": which tool counts
// as the receipt, and which phrasings count as a claim.
type claimGateDesc struct {
	Tool    string   `yaml:"tool"`
	Phrases []string `yaml:"phrases"`
}

// manifest — only produces a declaration once both fields are filled in; a
// capability that never declared claim_gate gets nil.
func (c claimGateDesc) manifest() *mcpplugin.ClaimGateDecl {
	decl := &mcpplugin.ClaimGateDecl{Tool: c.Tool, Phrases: c.Phrases}
	if !decl.Usable() {
		return nil
	}
	return decl
}
