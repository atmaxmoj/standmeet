// builtin_spec.go — builds an eval PluginSpec from **the manifest the product
// itself ships**.
//
// Before this, every eval that mounted a plugin hand-copied its properties
// (host ops / raw tool names / ACL tier). The hand-copied version didn't
// track the manifest: the manifest changed its acl, eval still loaded the
// old tier, so eval was testing a configuration that doesn't exist in the
// product — and it stayed green forever.
//
// There is one declaration: backend/blocks/<id>/manifest.yaml,
// embedded via go:embed into the binary — prod and eval read the same bytes.

package agentcore

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/blocks"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// BuiltinManifest — fetches a built-in block's declaration by id.
// Not found → error (a misspelled id should surface immediately).
func BuiltinManifest(id string) (plugin.Manifest, error) {
	all, err := plugin.Load(blocks.FS)
	if err != nil {
		return plugin.Manifest{}, fmt.Errorf("load builtin manifests: %w", err)
	}
	for i := range all {
		if all[i].ID == id {
			return all[i], nil
		}
	}
	return plugin.Manifest{}, fmt.Errorf("no builtin block %q", id)
}

// BuiltinPluginSpec — a builtin block's manifest → an eval PluginSpec.
//
// command is the plugin binary **built on this machine** (the /plugin/xxx path
// in the manifest is prod's in-sandbox path); sock is the mini-host's socket.
// Everything else follows the manifest: which host ops it calls, whether tool
// names get a prefix, which ACL tier applies.
func BuiltinPluginSpec(id, command, sock string) (PluginSpec, error) {
	m, err := BuiltinManifest(id)
	if err != nil {
		return PluginSpec{}, err
	}
	spec := PluginSpec{
		ID: m.ID, Command: command,
		RawToolNames: m.RawToolNames,
		ACLAlways:    m.ACL == plugin.ACLAlways,
	}
	if m.Transport.Sandbox != nil {
		spec.HostOps = m.Transport.Sandbox.HostOps
	}
	if len(spec.HostOps) > 0 {
		spec.Env = map[string]string{HostSocketEnv: sock}
	}
	return spec, nil
}
