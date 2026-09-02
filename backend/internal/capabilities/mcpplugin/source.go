// source.go —— discovery source: parses a Manifest list out of the install
// config (file / bytes).

package mcpplugin

import (
	"encoding/json"
	"fmt"
	"os"
)

// Result —— the output of one parse: Manifests that passed validation +
// Skipped ones (with reason).
type Result struct {
	Manifests []Manifest
	Skipped   []Skip
}

// Skip —— one skipped manifest and why (the caller is responsible for logging it).
type Skip struct {
	ID     string
	Reason string
}

type configDoc struct {
	Plugins []rawManifest `json:"plugins"`
}

type rawManifest struct {
	Requires         []string     `json:"requires"`
	ID               string       `json:"id"`
	Version          string       `json:"version"`
	Shape            string       `json:"shape"`
	PromptFragmentID string       `json:"prompt_fragment_id"`
	ACL              string       `json:"acl"`
	Transport        rawTransport `json:"transport"`
	RawToolNames     bool         `json:"raw_tool_names"`
}

type rawTransport struct {
	Env     map[string]string `json:"env"`
	Headers map[string]string `json:"headers"`
	Sandbox *rawSandbox       `json:"sandbox"`
	Kind    string            `json:"kind"`
	Command string            `json:"command"`
	URL     string            `json:"url"`
	Args    []string          `json:"args"`
}

type rawSandbox struct {
	PluginDir string `json:"plugin_dir"`
	// HostOps —— third-party plugins also order by name; the host only dispatches
	// names in the word list, and starting with a name not in it fails loudly.
	// (This used to be host_sockets: a list of file paths. Declared as files, the
	// mechanism couldn't answer "what sits on this file".)
	HostOps   []string `json:"host_ops"`
	AllowNet  bool     `json:"allow_net"`
	Workspace bool     `json:"workspace"`
}

// Load —— reads + parses from a config file path. Empty path / file doesn't
// exist → empty Result (a deployment with no plugins by default is valid); a read
// failure (permissions, etc.) → error.
func Load(path string) (Result, error) {
	if path == "" {
		return Result{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil && os.IsNotExist(err) {
		return Result{}, nil
	}
	if err != nil {
		return Result{}, fmt.Errorf("mcpplugin: read config %q: %w", path, err)
	}
	return ParseConfig(data)
}

// ParseConfig —— parses config bytes. The whole thing fails to parse → error;
// a single entry failing validation → goes into Skipped.
func ParseConfig(data []byte) (Result, error) {
	var doc configDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		return Result{}, fmt.Errorf("mcpplugin: parse config: %w", err)
	}
	return validateAll(doc.Plugins), nil
}

func validateAll(raws []rawManifest) Result {
	res := Result{}
	seen := map[string]bool{}
	for i := range raws {
		res.absorb(&raws[i], seen)
	}
	return res
}

func (res *Result) absorb(r *rawManifest, seen map[string]bool) {
	if reason := validationReason(r); reason != "" {
		res.Skipped = append(res.Skipped, Skip{ID: r.ID, Reason: reason})
		return
	}
	if seen[r.ID] {
		res.Skipped = append(res.Skipped, Skip{ID: r.ID, Reason: "duplicate id"})
		return
	}
	seen[r.ID] = true
	res.Manifests = append(res.Manifests, toManifest(r))
}

func validationReason(r *rawManifest) string {
	if reason := basicReason(r); reason != "" {
		return reason
	}
	return transportReason(&r.Transport)
}

func basicReason(r *rawManifest) string {
	switch {
	case r.ID == "":
		return "missing id"
	case r.Version != SupportedVersion:
		return "unsupported version " + r.Version
	case !validShape(r.Shape):
		return "invalid shape " + r.Shape
	}
	return ""
}

func validShape(s string) bool {
	return s == string(ShapeVisitorOnly) ||
		s == string(ShapeOwnerOnly) ||
		s == string(ShapeBoth)
}

func transportReason(t *rawTransport) string {
	switch t.Kind {
	case "stdio":
		return missingReason(t.Command, "stdio transport missing command")
	case "http":
		return missingReason(t.URL, "http transport missing url")
	case TransportSandboxStdio:
		return sandboxStdioReason(t)
	default:
		return "unknown transport kind " + t.Kind
	}
}

// sandboxStdioReason —— sandbox_stdio requires an in-container start command +
// sandbox.plugin_dir (the code directory).
func sandboxStdioReason(t *rawTransport) string {
	if t.Command == "" {
		return "sandbox_stdio transport missing command"
	}
	if t.Sandbox == nil || t.Sandbox.PluginDir == "" {
		return "sandbox_stdio transport missing sandbox.plugin_dir"
	}
	return ""
}

// normalizeACL —— empty / unknown → defaults to role_granted (the strictest,
// same as echoer). Only an explicit "always" relaxes it to unconditional exposure.
func normalizeACL(acl string) string {
	if acl == ACLAlways {
		return ACLAlways
	}
	return ACLRoleGranted
}

func missingReason(v, reason string) string {
	if v == "" {
		return reason
	}
	return ""
}

func toManifest(r *rawManifest) Manifest {
	m := Manifest{
		ID:               r.ID,
		Version:          r.Version,
		Shape:            Shape(r.Shape),
		PromptFragmentID: r.PromptFragmentID,
		ACL:              normalizeACL(r.ACL),
		RawToolNames:     r.RawToolNames,
		Requires:         r.Requires,
		Transport: Transport{
			Kind:    r.Transport.Kind,
			Command: r.Transport.Command,
			Args:    r.Transport.Args,
			Env:     r.Transport.Env,
			URL:     r.Transport.URL,
			Headers: r.Transport.Headers,
		},
	}
	if r.Transport.Sandbox != nil {
		m.Transport.Sandbox = &Sandbox{
			PluginDir: r.Transport.Sandbox.PluginDir,
			HostOps:   r.Transport.Sandbox.HostOps,
			AllowNet:  r.Transport.Sandbox.AllowNet,
			Workspace: r.Transport.Sandbox.Workspace,
		}
	}
	return m
}
