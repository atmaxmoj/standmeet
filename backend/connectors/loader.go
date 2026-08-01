// loader.go —— 读出所有内置连接器 manifest（拉起时调一次）。数据文件在本目录的
// <id>/ 子目录里（google-calendar/ smtp/ bearer-api/），go:embed 进二进制。
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

// descriptor —— data/<id>/manifest.yaml 的形状（声明 kind/品类 + 引用的 spec/binding 文件
// + 这个连接器自己出的 owner 侧操作）。
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

// ownerOpDesc —— manifest 里一条 owner 操作的声明。
//
// input_schema 是一份 **JSON Schema**,所以在 manifest 里就按 JSON 原样写(YAML 的块标量)。
// 不翻译成 YAML 映射再编回去:那样等于把同一份 schema 写成第二种语法,读的人还得在脑子里转。
type ownerOpDesc struct {
	Name        string `yaml:"name"`
	Op          string `yaml:"op"`
	Description string `yaml:"description"`
	InputSchema string `yaml:"input_schema"`
}

// Load —— 读出所有内置连接器 manifest（拉起时调一次）。
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

// loadOne —— 读一个内置连接器目录：descriptor + 引用的 spec/binding 文件。
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

// ownerOps —— 声明里的 owner 操作 → manifest 上的那份数据。
//
// schema 当场校验:一份编不动的 schema 会让整张工具表 marshal 失败(历史上真发生过),
// 与其等到那时候,不如拉起时就拒。
func ownerOps(dir string, decls []ownerOpDesc) ([]connector.OwnerOp, error) {
	out := make([]connector.OwnerOp, 0, len(decls))
	for i := range decls {
		schema := json.RawMessage(decls[i].InputSchema)
		if !json.Valid(schema) {
			return nil, fmt.Errorf(
				"connector %s owner op %q: input_schema is not valid JSON", dir, decls[i].Name)
		}
		out = append(out, connector.OwnerOp{
			Name: decls[i].Name, Op: decls[i].Op,
			Description: decls[i].Description, InputSchema: schema,
		})
	}
	return out, nil
}

// loadRefs —— 读 descriptor 引用的 spec/binding 文件进 manifest（openapi kind 才有）。
func loadRefs(dir string, d *descriptor, m *connector.Manifest) error {
	if d.Spec != "" {
		raw, err := builtinFS.ReadFile(path.Join(dir, d.Spec))
		if err != nil {
			return fmt.Errorf("read %s spec: %w", dir, err)
		}
		m.Spec = expandEnv(raw) // ${VAR:-default} 端点：prod 默认，e2e 指向 mock
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
