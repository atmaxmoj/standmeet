// manifest_test.go —— C1: pure-logic tests for PluginManifest parsing + version
// gate + validation. Runs in a deterministic environment → assertions are all
// require.* (no if branches). C1 is the pure data layer (no stream); it covers
// happy + all corner cases. Error-stream (mid-run failure) starts at C2 (transport/dial).
package mcpplugin_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// ownerRW —— permission for the test's temp config file (owner read/write).
const ownerRW os.FileMode = 0o600

// wrap —— wraps a single plugin JSON into a full config document.
func wrap(plugin string) []byte {
	return []byte(`{"plugins":[` + plugin + `]}`)
}

// --- happy: full-field parsing for both stdio and http transports ---

func TestParseConfig_StdioAndHttp(t *testing.T) {
	t.Parallel()
	data := []byte(`{"plugins":[
	  {"id":"booking","version":"1","shape":"visitor_only",
	   "transport":{"kind":"stdio","command":"booking-plugin",
	     "args":["--serve"],"env":{"FOO":"bar"}},
	   "requires":["calendar","smtp"],
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

	w := res.Manifests[1]
	require.Equal(t, "weather", w.ID)
	require.Equal(t, mcpplugin.ShapeBoth, w.Shape)
	require.Equal(t, "http", w.Transport.Kind)
	require.Equal(t, "http://weather:9000/mcp", w.Transport.URL)
	require.Equal(t, "Bearer x", w.Transport.Headers["Authorization"])
}

// --- corner: malformed JSON → error on the whole doc (the only fail-closed case) ---

func TestParseConfig_MalformedJSON(t *testing.T) {
	t.Parallel()
	_, err := mcpplugin.ParseConfig([]byte(`{"plugins":[ this is not json`))
	require.Error(t, err)
}

// --- corner: empty / missing plugins → empty Result, no error ---

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

// --- corner: per-entry validation failure = skip + record reason (fail-open per-manifest) ---

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

// --- corner: duplicate id → the second entry is skipped, the first stays ---

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

// --- corner: mix of good and bad → good one passes, bad one is filtered, independently ---

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

// --- happy: Load reads a real, valid file → parses out a manifest ---

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

// --- corner: missing source / empty path → empty Result, no error
// (a deployment with no plugins by default is valid) ---

func TestLoad_MissingOrEmpty(t *testing.T) {
	t.Parallel()
	res, err := mcpplugin.Load("")
	require.NoError(t, err)
	require.Empty(t, res.Manifests)

	res2, err2 := mcpplugin.Load(filepath.Join(t.TempDir(), "nope.json"))
	require.NoError(t, err2)
	require.Empty(t, res2.Manifests)
}
