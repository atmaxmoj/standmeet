// loader.go —— 读出所有内置连接器 manifest（拉起时调一次）。数据文件在本目录的
// <id>/ 子目录里（google-calendar/ smtp/ bearer-api/），go:embed 进二进制。
// (Package doc lives in embed.go.)

package connectors

import (
	"fmt"
	"io/fs"
	"path"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// descriptor —— data/<id>/manifest.yaml 的形状（声明 kind/品类 + 引用的 spec/binding 文件）。
type descriptor struct {
	ID         string `yaml:"id"`
	Kind       string `yaml:"kind"`
	Category   string `yaml:"category"`
	Protocol   string `yaml:"protocol"`
	AuthScheme string `yaml:"auth_scheme"`
	Spec       string `yaml:"spec"`
	Binding    string `yaml:"binding"`
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
	m := connector.Manifest{
		ID: d.ID, Kind: d.Kind, Category: d.Category,
		Protocol: d.Protocol, AuthScheme: d.AuthScheme,
	}
	if rerr := loadRefs(dir, &d, &m); rerr != nil {
		return connector.Manifest{}, rerr
	}
	return m, nil
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
