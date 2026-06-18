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
	UI               *rawUI       `json:"ui"`
	Requires         []string     `json:"requires"`
	ID               string       `json:"id"`
	Version          string       `json:"version"`
	Shape            string       `json:"shape"`
	PromptFragmentID string       `json:"prompt_fragment_id"`
	Transport        rawTransport `json:"transport"`
}

type rawTransport struct {
	Env     map[string]string `json:"env"`
	Headers map[string]string `json:"headers"`
	Kind    string            `json:"kind"`
	Command string            `json:"command"`
	URL     string            `json:"url"`
	Args    []string          `json:"args"`
}

type rawUI struct {
	ResourceURI string `json:"resource_uri"`
	MimeType    string `json:"mime_type"`
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
	default:
		return "unknown transport kind " + t.Kind
	}
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
	if r.UI != nil {
		m.UI = &UI{ResourceURI: r.UI.ResourceURI, MimeType: r.UI.MimeType}
	}
	return m
}
