// loader.go —— reads out all builtin connector manifests (called once at launch). Data
// files live in this directory's <id>/ subdirectories (google-calendar/ smtp/ bearer-api/),
// embedded via go:embed into the binary.
// (Package doc lives in embed.go.)

package connectors

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// descriptor —— the shape of data/<id>/manifest.yaml (declares kind/category + the
// referenced spec/binding files + this connector's own owner-side operations).
type descriptor struct {
	ID         string        `yaml:"id"`
	Kind       string        `yaml:"kind"`
	Category   string        `yaml:"category"`
	Protocol   string        `yaml:"protocol"`
	AuthScheme string        `yaml:"auth_scheme"`
	Spec       string        `yaml:"spec"`
	Binding    string        `yaml:"binding"`
	OwnerOps   []ownerOpDesc `yaml:"owner_ops"`
}

// ownerOpDesc —— one owner-operation declaration inside a manifest.
//
// input_schema is a **JSON Schema**, so it's written verbatim as JSON in the manifest
// (a YAML block scalar). It is not translated into a YAML mapping and encoded back: that
// would write the same schema in a second syntax, forcing the reader to mentally convert it.
type ownerOpDesc struct {
	Name        string `yaml:"name"`
	Op          string `yaml:"op"`
	Description string `yaml:"description"`
	InputSchema string `yaml:"input_schema"`
}

// Load —— reads out all builtin connector manifests (called once at launch).
func Load() ([]connector.Manifest, error) {
	entries, err := fs.ReadDir(builtinFS, ".")
	if err != nil {
		return nil, fmt.Errorf("read builtin connectors dir: %w", err)
	}
	manifests := make([]connector.Manifest, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, lerr := loadOne(e.Name())
		if lerr != nil {
			return nil, lerr
		}
		manifests = append(manifests, m)
	}
	return manifests, nil
}

// loadOne —— reads one builtin connector directory: descriptor + its referenced
// spec/binding files.
func loadOne(dir string) (connector.Manifest, error) {
	descRaw, err := builtinFS.ReadFile(path.Join(dir, "manifest.yaml"))
	if err != nil {
		return connector.Manifest{}, fmt.Errorf("read %s manifest: %w", dir, err)
	}
	var d descriptor
	if uerr := yaml.Unmarshal(descRaw, &d); uerr != nil {
		return connector.Manifest{}, fmt.Errorf("parse %s manifest: %w", dir, uerr)
	}
	ops, operr := ownerOps(dir, d.OwnerOps)
	if operr != nil {
		return connector.Manifest{}, operr
	}
	m := connector.Manifest{
		ID: d.ID, Kind: d.Kind, Category: d.Category,
		Protocol: d.Protocol, AuthScheme: d.AuthScheme, OwnerOps: ops,
	}
	if rerr := loadRefs(dir, &d, &m); rerr != nil {
		return connector.Manifest{}, rerr
	}
	return m, nil
}

// ownerOps —— the owner operations in the declaration → the data carried on the manifest.
//
// The schema is validated on the spot: one schema that fails to marshal takes down the
// whole tool-table marshal (this actually happened before), so it's better to reject at
// launch than let that happen later.
func ownerOps(dir string, decls []ownerOpDesc) ([]connector.OwnerOp, error) {
	out := make([]connector.OwnerOp, 0, len(decls))
	for i := range decls {
		schema := json.RawMessage(decls[i].InputSchema)
		if !json.Valid(schema) {
			return nil, fmt.Errorf(
				"connector %s owner op %q: input_schema is not valid JSON", dir, decls[i].Name)
		}
		op := connector.OwnerOp{
			Name: decls[i].Name, Op: decls[i].Op,
			Description: decls[i].Description, InputSchema: schema,
		}
		// A field is declared but can't be derived on the surface → reject at launch.
		// This used to **silently skip**: the manifest said the op takes `days`, the op
		// really accepted it, but the card had no such field, so the owner couldn't fill
		// it in and nobody noticed (F-C-17). Same discipline as "declaring an op that
		// isn't implemented crashes on startup" — what's declared must actually reach
		// the surface.
		if bad := op.UnrenderableFields(); len(bad) > 0 {
			return nil, fmt.Errorf(
				"connector %s owner op %q: input fields %v cannot be rendered "+
					"(only string / integer / number are derivable)", dir, decls[i].Name, bad)
		}
		out = append(out, op)
	}
	return out, nil
}

// loadRefs —— reads the spec/binding files referenced by descriptor into the manifest
// (present only for the openapi kind).
func loadRefs(dir string, d *descriptor, m *connector.Manifest) error {
	if d.Spec != "" {
		raw, err := builtinFS.ReadFile(path.Join(dir, d.Spec))
		if err != nil {
			return fmt.Errorf("read %s spec: %w", dir, err)
		}
		m.Spec = expandEnv(raw) // ${VAR:-default} endpoints: prod default, e2e points at mock
	}
	if d.Binding != "" {
		raw, err := builtinFS.ReadFile(path.Join(dir, d.Binding))
		if err != nil {
			return fmt.Errorf("read %s binding: %w", dir, err)
		}
		m.Binding = expandEnv(raw)
	}
	return nil
}
