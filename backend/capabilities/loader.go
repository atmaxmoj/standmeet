// loader.go — reads out every built-in capability manifest (called once at
// startup). The data files live in this dir's <id>/ subdirectories, go:embed'd
// into the binary. (Package doc is in embed.go.)

package capabilities

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"path"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// socketEnv — the env var the host injects this capability's host-socket path into.
//
// The name is the same for every capability; the path is derived from the id.
// Previously each capability picked its own name (BOOKER_SOCKET /
// RETRIEVAL_SOCKET / ...), and the path had to be hand-written again in the
// host's declaration — the same thing under four names, plus four places the
// path could be typed wrong. The declaration now only says "which things I need".
const socketEnv = "STANDMEET_HOST_SOCKET"

// Load — reads out every built-in capability manifest.
func Load() ([]mcpplugin.Manifest, error) {
	entries, err := fs.ReadDir(builtinFS, ".")
	if err != nil {
		return nil, fmt.Errorf("read builtin capabilities dir: %w", err)
	}
	out := make([]mcpplugin.Manifest, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, lerr := loadOne(e.Name())
		if lerr != nil {
			return nil, lerr
		}
		out = append(out, m)
	}
	return out, nil
}

// loadOne — reads one built-in capability directory.
func loadOne(dir string) (mcpplugin.Manifest, error) {
	raw, err := builtinFS.ReadFile(path.Join(dir, "manifest.yaml"))
	if err != nil {
		return mcpplugin.Manifest{}, fmt.Errorf("read %s manifest: %w", dir, err)
	}
	var d descriptor
	if uerr := yaml.Unmarshal(raw, &d); uerr != nil {
		return mcpplugin.Manifest{}, fmt.Errorf("parse %s manifest: %w", dir, uerr)
	}
	tools, terr := ownerTools(dir, d.OwnerTools)
	if terr != nil {
		return mcpplugin.Manifest{}, terr
	}
	return mcpplugin.Manifest{
		ID: d.ID, Title: d.Title, Version: d.Version,
		Shape: mcpplugin.Shape(d.Shape), ACL: acl(d.ACL),
		RawToolNames: d.RawToolNames, Requires: d.Requires,
		VisitorTools:        visitorToolNames(d.VisitorTools),
		VisitorToolRequires: visitorToolRequires(d.VisitorTools),
		OwnerTools:          tools,
		Config:              fields(d.Config), CodeConfig: fields(d.CodeConfig),
		RoleConfig: fields(d.RoleConfig),
		Quota:      d.Quota.manifest(),
		ClaimGate:  d.ClaimGate.manifest(),
		Transport:  transport(d.ID, &d.Transport),
	}, nil
}

// transport — transport declaration → manifest. The socket path **is derived and
// injected right here**; the manifest never writes a path: only a capability
// that ordered a host op gets a socket, one that ordered none is fully offline.
func transport(id string, t *transportDesc) mcpplugin.Transport {
	out := mcpplugin.Transport{
		Kind: t.Kind, Command: t.Command, Args: t.Args, URL: t.URL,
		Env: map[string]string{}, Headers: t.Headers,
	}
	maps.Copy(out.Env, t.Env)
	if t.Sandbox == nil {
		return out
	}
	out.Sandbox = &mcpplugin.Sandbox{
		PluginDir: t.Sandbox.PluginDir, HostOps: t.Sandbox.HostOps,
		AllowNet: t.Sandbox.AllowNet, Workspace: t.Sandbox.Workspace,
	}
	if len(t.Sandbox.HostOps) > 0 {
		out.Env[socketEnv] = hostop.SocketPath(id)
	}
	return out
}

// acl — empty → strictest (role_granted). A missing declaration must never turn
// into "open to everyone".
func acl(v string) string {
	if v == mcpplugin.ACLAlways {
		return mcpplugin.ACLAlways
	}
	return mcpplugin.ACLRoleGranted
}

// visitorToolNames — just the names. Used both to answer "which tool belongs to
// which capability" before assembly, and to reconcile against what the sandbox
// actually answers (drift check); the shape is unchanged.
func visitorToolNames(decls []visitorToolDesc) []string {
	out := make([]string, 0, len(decls))
	for i := range decls {
		out = append(out, decls[i].Name)
	}
	return out
}

// visitorToolRequires — only keeps **the entries that wrote a requires**. One
// that didn't write one never enters the map: "absent from the map" and "present
// as an empty slice" must mean the same thing here, and one more spelling is one
// more place to have to check.
func visitorToolRequires(decls []visitorToolDesc) map[string][]string {
	out := map[string][]string{}
	for i := range decls {
		if len(decls[i].Requires) > 0 {
			out[decls[i].Name] = decls[i].Requires
		}
	}
	return out
}

// ownerTools — owner-facing declarations → manifest.
//
// The schema is validated right here: an unmarshalable schema fails marshaling
// for the whole tool table (this has actually happened before), so it's better
// to reject it at startup than to wait for that.
func ownerTools(dir string, decls []ownerToolDesc) ([]mcpplugin.OwnerTool, error) {
	out := make([]mcpplugin.OwnerTool, 0, len(decls))
	for i := range decls {
		if !json.Valid([]byte(decls[i].InputSchema)) {
			return nil, fmt.Errorf(
				"capability %s owner tool %q: input_schema is not valid JSON", dir, decls[i].Name)
		}
		out = append(out, mcpplugin.OwnerTool{
			Name: decls[i].Name, Tool: decls[i].Tool,
			Description: decls[i].Description, InputSchema: decls[i].InputSchema,
		})
	}
	return out, nil
}

// fields — config-item declarations → manifest (the owner-facing side and the
// code side share this same set).
func fields(decls []fieldDesc) []mcpplugin.ConfigField {
	out := make([]mcpplugin.ConfigField, 0, len(decls))
	for i := range decls {
		out = append(out, mcpplugin.ConfigField{
			Key: decls[i].Key, Label: decls[i].Label, Type: decls[i].Type,
			Description: decls[i].Description, Default: decls[i].Default,
			Min: decls[i].Min, Max: decls[i].Max,
		})
	}
	return out
}
