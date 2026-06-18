// manifest_test.go —— C1: PluginManifest 解析 + 版本闸 + 校验的纯逻辑测试。
// 跑在确定环境 → 断言一律 require.*（无 if 分支）。C1 是纯数据层（无流），
// 覆盖 happy + 全 corner cases；error-stream（中途出错）从 C2 起（传输/dial）。
package mcpplugin_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

// ownerRW —— 测试临时配置文件权限（owner 读写）。
const ownerRW os.FileMode = 0o600

// wrap —— 把单条 plugin JSON 包成完整配置文档。
func wrap(plugin string) []byte {
	return []byte(`{"plugins":[` + plugin + `]}`)
}

// --- happy：stdio + http 两种 transport 全字段解析 ---

func TestParseConfig_StdioAndHttp(t *testing.T) {
	t.Parallel()
	data := []byte(`{"plugins":[
	  {"id":"booking","version":"1","shape":"visitor_only",
	   "transport":{"kind":"stdio","command":"booking-plugin",
	     "args":["--serve"],"env":{"FOO":"bar"}},
	   "requires":["calendar","smtp"],
	   "ui":{"resource_uri":"ui://booking-card","mime_type":"text/html+mcp"},
	   "prompt_fragment_id":"capabilities/booking"},
	  {"id":"weather","version":"1","shape":"both",
	   "transport":{"kind":"http","url":"http://weather:9000/mcp",
	     "headers":{"Authorization":"Bearer x"}}}
	]}`)
	res, err := mcpplugin.ParseConfig(data)
	require.NoError(t, err)
	require.Empty(t, res.Skipped)
	require.Len(t, res.Manifests, 2)

	b := res.Manifests[0]
	require.Equal(t, "booking", b.ID)
	require.Equal(t, "1", b.Version)
	require.Equal(t, mcpplugin.ShapeVisitorOnly, b.Shape)
	require.Equal(t, "stdio", b.Transport.Kind)
	require.Equal(t, "booking-plugin", b.Transport.Command)
	require.Equal(t, []string{"--serve"}, b.Transport.Args)
	require.Equal(t, "bar", b.Transport.Env["FOO"])
	require.Equal(t, []string{"calendar", "smtp"}, b.Requires)
	require.Equal(t, "capabilities/booking", b.PromptFragmentID)
	require.NotNil(t, b.UI)
	require.Equal(t, "ui://booking-card", b.UI.ResourceURI)
	require.Equal(t, "text/html+mcp", b.UI.MimeType)

	w := res.Manifests[1]
	require.Equal(t, "weather", w.ID)
	require.Equal(t, mcpplugin.ShapeBoth, w.Shape)
	require.Equal(t, "http", w.Transport.Kind)
	require.Equal(t, "http://weather:9000/mcp", w.Transport.URL)
	require.Equal(t, "Bearer x", w.Transport.Headers["Authorization"])
	require.Nil(t, w.UI)
}

// --- corner：畸形 JSON → 整体报错（唯一 fail-closed 情形）---

func TestParseConfig_MalformedJSON(t *testing.T) {
	t.Parallel()
	_, err := mcpplugin.ParseConfig([]byte(`{"plugins":[ this is not json`))
	require.Error(t, err)
}

// --- corner：空 / 缺 plugins → 空 Result，无 error ---

func TestParseConfig_EmptyPlugins(t *testing.T) {
	t.Parallel()
	res, err := mcpplugin.ParseConfig([]byte(`{"plugins":[]}`))
	require.NoError(t, err)
	require.Empty(t, res.Manifests)
	require.Empty(t, res.Skipped)

	res2, err2 := mcpplugin.ParseConfig([]byte(`{}`))
	require.NoError(t, err2)
	require.Empty(t, res2.Manifests)
}

// --- corner：逐条校验失败 = 跳过 + 记 reason（fail-open per-manifest）---

func TestParseConfig_PerManifestRejections(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		plugin string
		reason string
	}{
		{
			"missing id",
			`{"version":"1","shape":"both","transport":{"kind":"http","url":"u"}}`,
			"missing id",
		},
		{
			"unsupported version",
			`{"id":"a","version":"99","shape":"both","transport":{"kind":"http","url":"u"}}`,
			"unsupported version 99",
		},
		{
			"invalid shape",
			`{"id":"a","version":"1","shape":"sideways","transport":{"kind":"http","url":"u"}}`,
			"invalid shape sideways",
		},
		{
			"unknown transport",
			`{"id":"a","version":"1","shape":"both","transport":{"kind":"carrier-pigeon"}}`,
			"unknown transport kind carrier-pigeon",
		},
		{
			"stdio no command",
			`{"id":"a","version":"1","shape":"both","transport":{"kind":"stdio"}}`,
			"stdio transport missing command",
		},
		{
			"http no url",
			`{"id":"a","version":"1","shape":"both","transport":{"kind":"http"}}`,
			"http transport missing url",
		},
	}
	for _, c := range cases {
		res, err := mcpplugin.ParseConfig(wrap(c.plugin))
		require.NoError(t, err, c.name)
		require.Empty(t, res.Manifests, c.name)
		require.Len(t, res.Skipped, 1, c.name)
		require.Equal(t, c.reason, res.Skipped[0].Reason, c.name)
	}
}

// --- corner：重复 id → 第二条被跳，第一条留下 ---

func TestParseConfig_DuplicateID(t *testing.T) {
	t.Parallel()
	data := []byte(`{"plugins":[
	  {"id":"dup","version":"1","shape":"both","transport":{"kind":"http","url":"u1"}},
	  {"id":"dup","version":"1","shape":"both","transport":{"kind":"http","url":"u2"}}
	]}`)
	res, err := mcpplugin.ParseConfig(data)
	require.NoError(t, err)
	require.Len(t, res.Manifests, 1)
	require.Equal(t, "u1", res.Manifests[0].Transport.URL)
	require.Len(t, res.Skipped, 1)
	require.Equal(t, "dup", res.Skipped[0].ID)
	require.Equal(t, "duplicate id", res.Skipped[0].Reason)
}

// --- corner：好坏混合 → 好的进、坏的滤，互不影响 ---

func TestParseConfig_MixedValidInvalid(t *testing.T) {
	t.Parallel()
	data := []byte(`{"plugins":[
	  {"id":"good","version":"1","shape":"both","transport":{"kind":"http","url":"u"}},
	  {"id":"bad","version":"99","shape":"both","transport":{"kind":"http","url":"u"}}
	]}`)
	res, err := mcpplugin.ParseConfig(data)
	require.NoError(t, err)
	require.Len(t, res.Manifests, 1)
	require.Equal(t, "good", res.Manifests[0].ID)
	require.Len(t, res.Skipped, 1)
	require.Equal(t, "bad", res.Skipped[0].ID)
}

// --- happy：Load 读真实合法文件 → 解析出 manifest ---

func TestLoad_ReadsValidFile(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "plugins.json")
	cfg := `{"plugins":[{"id":"x","version":"1","shape":"both",` +
		`"transport":{"kind":"http","url":"u"}}]}`
	require.NoError(t, os.WriteFile(path, []byte(cfg), ownerRW))

	res, err := mcpplugin.Load(path)
	require.NoError(t, err)
	require.Len(t, res.Manifests, 1)
	require.Equal(t, "x", res.Manifests[0].ID)
}

// --- corner：来源缺失 / 空路径 → 空 Result，无 error（部署默认无插件，合法）---

func TestLoad_MissingOrEmpty(t *testing.T) {
	t.Parallel()
	res, err := mcpplugin.Load("")
	require.NoError(t, err)
	require.Empty(t, res.Manifests)

	res2, err2 := mcpplugin.Load(filepath.Join(t.TempDir(), "nope.json"))
	require.NoError(t, err2)
	require.Empty(t, res2.Manifests)
}
