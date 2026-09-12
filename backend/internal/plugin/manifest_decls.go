// manifest_decls.go — the things a manifest declares ABOUT its tools and settings, as
// opposed to the manifest itself.
//
// Split out of manifest.go along a real seam rather than wherever the line count ran out:
// that file answers "what is a block, and how is it reached", this one "what does a block
// declare that the host then renders, counts, or checks". Adding a settings type touches
// only this file.

package plugin

import (
	"fmt"

	yaml "go.yaml.in/yaml/v3"
)

// VisitorTool — one tool this block offers the visitor's agent.
//
// Requires here is per TOOL, and it answers a question the block-level Requires
// cannot: with only `calendar.readonly` granted, connecting works and listing
// slots works, and only writing must always fail. Moving that requirement up to
// the block would hide listing slots along with booking (F-B-8).
type VisitorTool struct {
	Name     string   `yaml:"name"`
	Requires []string `yaml:"requires"`
}

// VisitorToolNames — just the names, for the places that only ask "which tools".
//
// Kept as one function rather than open-coded at each call site: the two spellings
// mean a bare entry and a mapping entry both carry a name, and every caller that
// re-derives that itself is a place the short spelling can be forgotten.
func VisitorToolNames(ts []VisitorTool) []string {
	out := make([]string, 0, len(ts))
	for i := range ts {
		out = append(out, ts[i].Name)
	}
	return out
}

// UnmarshalYAML — both spellings are accepted, and most entries use the short one:
//
//	visitor_tools:
//	  - calendar_list_slots                    # the block's own requires is enough
//	  - name: calendar_book                    # this one action needs something more
//	    requires: [calendar:events.insert]
//
// Making every entry a mapping would tax the common case to serve the rare one. The
// two forms mean the same thing; a bare string is a tool with nothing extra to say.
func (v *VisitorTool) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind == yaml.ScalarNode {
		if err := n.Decode(&v.Name); err != nil {
			return fmt.Errorf("visitor_tools entry as a name: %w", err)
		}
		return nil
	}
	type raw VisitorTool // shed the method, keep the fields
	var r raw
	if err := n.Decode(&r); err != nil {
		return fmt.Errorf("visitor_tools entry as a mapping: %w", err)
	}
	*v = VisitorTool(r)
	return nil
}

// OwnerTool — one operation this block exposes to the owner's own AI client.
//
// InputSchema is JSON Schema, carried verbatim as a YAML block scalar — a string,
// which is what it is in the file. It is not transcribed into a YAML mapping and
// encoded back: that would spell one schema in two syntaxes and leave the reader
// converting between them. Validity is checked at load, not at serve.
type OwnerTool struct {
	Name        string `yaml:"name"`
	Tool        string `yaml:"tool"`
	Description string `yaml:"description"`
	InputSchema string `yaml:"input_schema"`
}

// ConfigField — one settings field, rendered by the admin without knowing what
// the block is. The same declaration validates a value on the way in.
//
// Field order follows pointer width — enforced by govet fieldalignment.
type ConfigField struct {
	Min         *int   `yaml:"min"`
	Max         *int   `yaml:"max"`
	Key         string `yaml:"key"`
	Label       string `yaml:"label"`
	Type        string `yaml:"type"`
	Description string `yaml:"description"`
	Default     string `yaml:"default"`
}

// Quota — how the host counts this block's use against a limit.
//
// The block does not carry the number. ConfigKey names the config field the limit
// is read from, so the owner sets it per code or per role; Collection and
// SubjectField say what to count and whose. A block that meters nothing leaves all
// three empty.
type Quota struct {
	ConfigKey    string `yaml:"config_key"`
	Collection   string `yaml:"collection"`
	SubjectField string `yaml:"subject_field"`
}

// Usable — reports whether this declaration can actually meter anything.
//
// All three or none. A half-filled declaration cannot count: without a collection
// there is nothing to count, without a subject field there is no whose, and without a
// config key there is no limit to compare against. Answering "unlimited" for a
// half-filled one is the safe reading, because a block that declares metering it
// cannot perform should not silently deny instead.
func (q *Quota) Usable() bool {
	return q != nil && q.ConfigKey != "" && q.Collection != "" && q.SubjectField != ""
}

// ClaimGate — phrases that, said by the agent, assert an outcome this block is the
// only one entitled to produce.
//
// Tool names the tool that really produces it; Phrases are what a model might say
// instead of calling it. Saying "it's on the calendar" without having booked one
// is the failure being gated.
type ClaimGate struct {
	Tool    string   `yaml:"tool"`
	Phrases []string `yaml:"phrases"`
}

// Usable — reports whether this gate can actually fire.
//
// Both halves or neither: phrases with no tool cannot be checked against anything,
// and a tool with no phrases never triggers. A half-filled declaration must read as
// "no gate" rather than as a gate that silently never fires — the second is the
// version an owner would not find out about.
func (g *ClaimGate) Usable() bool {
	return g != nil && g.Tool != "" && len(g.Phrases) > 0
}

// VisitorToolRequires — the per-tool requirements, keyed by tool name.
//
// Only entries that actually declared one appear. "Absent from the map" and "present
// with an empty slice" must mean the same thing to a caller, and one more spelling is
// one more place to forget the check.
func (m *Manifest) VisitorToolRequires() map[string][]string {
	out := map[string][]string{}
	for i := range m.VisitorTools {
		if len(m.VisitorTools[i].Requires) > 0 {
			out[m.VisitorTools[i].Name] = m.VisitorTools[i].Requires
		}
	}
	return out
}
