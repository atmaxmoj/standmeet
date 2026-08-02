// source.go —— 发现来源：从装机配置（文件 / 字节）解析出 Manifest 列表。

package mcpplugin

import (
	"encoding/json"
	"fmt"
	"os"
)

// Result —— 一次解析的产出：通过校验的 Manifests + 被跳过的 Skipped（带 reason）。
type Result struct {
	Manifests []Manifest
	Skipped   []Skip
}

// Skip —— 一条被跳过的 manifest 及原因（caller 负责 log）。
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
	// HostOps —— 第三方插件也按名字点单;宿主只发词表里有的,没有的名字启动就炸。
	// (原来这里是 host_sockets:一串文件路径。声明成文件,机制就答不出"这文件上有什么"。)
	HostOps   []string `json:"host_ops"`
	AllowNet  bool     `json:"allow_net"`
	Workspace bool     `json:"workspace"`
}

// Load —— 从配置文件路径读 + 解析。空路径 / 文件不存在 → 空 Result（部署默认无
// 插件，合法）；读失败（权限等）→ error。
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

// ParseConfig —— 解析配置字节。整份解析不了 → error；单条不过 → 进 Skipped。
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

// sandboxStdioReason —— sandbox_stdio 要有容器内启动 command + sandbox.plugin_dir
// （代码目录）。
func sandboxStdioReason(t *rawTransport) string {
	if t.Command == "" {
		return "sandbox_stdio transport missing command"
	}
	if t.Sandbox == nil || t.Sandbox.PluginDir == "" {
		return "sandbox_stdio transport missing sandbox.plugin_dir"
	}
	return ""
}

// normalizeACL —— 空 / 未知 → 默认 role_granted（最严，跟 echoer 同）。只有显式
// "always" 才放开成无条件暴露。
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
