// npm.go — mock npm registry for the dsh BLOCK marketplace e2e. Serves a search hit, a package
// document, and a generated tarball carrying a standmeet block manifest + the dsh.bundle.patch
// marker, so blocks.marketplace_search / blocks.marketplace_install can be driven hermetically
// (the backend's BLOCK_MARKET_NPM_BASE_URL points here). The installed block reuses the
// server-everything demo already provisioned at /srv/plugins-demos/everything — no new plugin
// code ships. The real registry is what dsh-market-live hits instead; this is the offline stand-in.

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

const (
	npmDemoPkg     = "@deepseek-ai/cordis-plugin-demo"
	npmDemoVersion = "1.0.0"
)

// npmDemoManifest — the standmeet.block.yaml the mock package carries; a real mountable block
// (server-everything under a foreign id), so install → mount → use works end to end.
const npmDemoManifest = `id: dshmarketdemo
title: DSH Market Demo (foreign)
version: "1"
shape: visitor_only
transport:
  kind: sandbox_stdio
  command: node
  args: ["/plugin/node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"]
  sandbox:
    plugin_dir: /srv/plugins-demos/everything
    allow_net: false
`

// npmDemoPkgJSON — carries dsh.bundle.patch, the marker install verifies.
const npmDemoPkgJSON = `{"name":"@deepseek-ai/cordis-plugin-demo","version":"1.0.0",` +
	`"dsh":{"bundle":{"patch":"cordis.patch.yml"}}}`

func (s *server) serveNpmSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("text")
	objects := []map[string]any{}
	if npmQueryMatchesDemo(q) {
		objects = append(objects, map[string]any{
			"package": map[string]any{
				"name": npmDemoPkg, "version": npmDemoVersion,
				"description": "Demo dsh block for the marketplace e2e.",
			},
		})
	}
	writeJSONBytes(s.log, w, mustJSON(s.log, map[string]any{"objects": objects}))
}

// npmQueryMatchesDemo — the demo package answers the dsh-scope query and anything plausibly
// about it; a clearly-absent query (e.g. "no-such-block-zzzq") returns an empty page.
func npmQueryMatchesDemo(q string) bool {
	l := strings.ToLower(q)
	return l == "" || strings.Contains(l, "cordis") || strings.Contains(l, "plugin") ||
		strings.Contains(l, "demo") || strings.Contains(l, "deepseek")
}

func (s *server) serveNpmPackage(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("id") != npmDemoPkg {
		http.Error(w, "no such package", http.StatusNotFound)
		return
	}
	doc := map[string]any{
		"dist-tags": map[string]any{"latest": npmDemoVersion},
		"versions": map[string]any{
			npmDemoVersion: map[string]any{
				"dist": map[string]any{"tarball": "http://" + r.Host + "/npm/tarball/" + npmDemoPkg},
			},
		},
	}
	writeJSONBytes(s.log, w, mustJSON(s.log, doc))
}

func (s *server) serveNpmTarball(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("id") != npmDemoPkg {
		http.Error(w, "no such tarball", http.StatusNotFound)
		return
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	writeTarFile(s.log, tw, "package/package.json", npmDemoPkgJSON)
	writeTarFile(s.log, tw, "package/standmeet.block.yaml", npmDemoManifest)
	writeTarFile(s.log, tw, "package/cordis.patch.yml", "name: dshmarketdemo\n")
	closeTar(s.log, tw, gz)
	w.Header().Set("Content-Type", "application/gzip")
	if _, err := w.Write(buf.Bytes()); err != nil {
		s.log.Error("write npm tarball", "err", err)
	}
}

func writeTarFile(log *slog.Logger, tw *tar.Writer, name, content string) {
	hdr := &tar.Header{Name: name, Mode: 0o644, Size: int64(len(content))}
	if err := tw.WriteHeader(hdr); err != nil {
		log.Error("tar header", "name", name, "err", err)
		return
	}
	if _, err := tw.Write([]byte(content)); err != nil {
		log.Error("tar write", "name", name, "err", err)
	}
}

func closeTar(log *slog.Logger, tw *tar.Writer, gz *gzip.Writer) {
	if err := tw.Close(); err != nil {
		log.Error("tar close", "err", err)
	}
	if err := gz.Close(); err != nil {
		log.Error("gzip close", "err", err)
	}
}

func mustJSON(log *slog.Logger, v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		log.Error("marshal json", "err", err)
	}
	return b
}
