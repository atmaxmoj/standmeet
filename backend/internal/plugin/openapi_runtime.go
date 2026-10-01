// openapi_runtime.go — what a TransportOpenAPI supplier runs on.
//
// An openapi supplier is DATA (a spec + a binding); it ships no code. Its calls run on one shared
// node engine (infra/plugins/openapi), spawned in the sandbox like any block, with the supplier's
// definition merged into each call. This is the meaning of the transport kind, not a block: no
// owner installs it, it faces nobody, and it is dialed under the id of whichever supplier it is
// running for.

package plugin

// OpenAPIRuntimeDir — where the shared openapi engine is provisioned (infra/plugins/provision.sh,
// backend/Dockerfile).
const OpenAPIRuntimeDir = "/srv/plugins/openapi"

// OpenAPIRuntime — the dial manifest that runs openapi supplier `id` on the shared engine. It
// reaches the network (the SaaS); the engine itself refuses internal addresses.
func OpenAPIRuntime(id string) Manifest {
	return Manifest{ID: id, Transport: Transport{
		Kind:    TransportSandboxStdio,
		Command: "node", Args: []string{"/plugin/openapi-mcp.js"},
		Sandbox: &Sandbox{PluginDir: OpenAPIRuntimeDir, AllowNet: true},
	}}
}
