// Package builtins —— 随产品发的内置连接器，**外置成数据**（data/*/ 里的 manifest + spec +
// binding 文件），go:embed 进二进制、拉起时 Load 出来装配。跟 MCP 内建插件同构：host 代码里
// **没有任何 gcal/smtp 字样**，契约只有这些数据文件 + 通用 runtime。内置与上传走同一个
// connector.AssembleOpenAPI / NewSMTPConnector，只是 manifest 数据来源不同（这里是 bundled）。
package builtins

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
	entries, err := fs.ReadDir(dataFS, "data")
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
	descRaw, err := dataFS.ReadFile(path.Join("data", dir, "manifest.yaml"))
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
		raw, err := dataFS.ReadFile(path.Join("data", dir, d.Spec))
		if err != nil {
			return fmt.Errorf("read %s spec: %w", dir, err)
		}
		m.Spec = raw
	}
	if d.Binding != "" {
		raw, err := dataFS.ReadFile(path.Join("data", dir, d.Binding))
		if err != nil {
			return fmt.Errorf("read %s binding: %w", dir, err)
		}
		m.Binding = raw
	}
	return nil
}
