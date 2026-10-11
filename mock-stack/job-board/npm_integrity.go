// npm_integrity.go — a package whose contents can change under the same version, the way a
// compromised mirror or a hijacked publish would change them (job-loop roadmap 7.2.a). Only the
// integrity package changes; the plain demo package stays fixed, so a parallel marketplace spec is
// never touched by these switches:
//
//	POST /__mock/npm/republish — new contents, with a matching dist.integrity (needs re-consent)
//	POST /__mock/npm/corrupt   — new contents, the old dist.integrity (refused on install)
//
// /__mock/reset puts the original package back. The flags live in the state's counter map.

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha512"
	"encoding/base64"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

const (
	npmIntegrityPkg = "@deepseek-ai/cordis-plugin-integrity"
	npmRevKey       = "npm@rev"
	npmCorruptKey   = "npm@corrupt"
)

func isNpmDemo(pkg string) bool { return pkg == npmDemoPkg || pkg == npmIntegrityPkg }

func (s *state) counter(key string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.throttle[key]
}

// npmDemoTarball — a demo package at a revision; revision 0 is the original. The integrity
// package carries its own block id, so both can be mounted side by side. Deterministic bytes (no
// times in the gzip or tar headers), so the integrity is stable.
func npmDemoTarball(log *slog.Logger, pkg string, rev int) []byte {
	manifest, pkgJSON := npmDemoManifest, npmDemoPkgJSON
	if pkg == npmIntegrityPkg {
		manifest = strings.Replace(manifest, "id: dshmarketdemo", "id: dshintegritydemo", 1)
		pkgJSON = strings.Replace(pkgJSON, npmDemoPkg, npmIntegrityPkg, 1)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	writeTarFile(log, tw, "package/package.json", pkgJSON)
	writeTarFile(log, tw, "package/standmeet.block.yaml", manifest)
	writeTarFile(log, tw, "package/cordis.patch.yml", "name: dshmarketdemo\n")
	if rev > 0 {
		writeTarFile(log, tw, "package/REVISION", strconv.Itoa(rev))
	}
	closeTar(log, tw, gz)
	return buf.Bytes()
}

// npmDemoIntegrity — the SRI string npm publishes for those bytes.
func npmDemoIntegrity(b []byte) string {
	sum := sha512.Sum512(b)
	return "sha512-" + base64.StdEncoding.EncodeToString(sum[:])
}

// npmDemoServed — what the tarball URL serves now, and the integrity the package doc states.
func (s *server) npmDemoServed(pkg string) (tarball []byte, integrity string) {
	rev, served := 0, 0
	if pkg == npmIntegrityPkg {
		rev = s.st.counter(npmRevKey)
		served = rev + s.st.counter(npmCorruptKey)
	}
	stated := npmDemoIntegrity(npmDemoTarball(s.log, pkg, rev))
	return npmDemoTarball(s.log, pkg, served), stated
}

func (s *server) adminNpmRepublish(w http.ResponseWriter, _ *http.Request) {
	s.st.setThrottle(npmRevKey, s.st.counter(npmRevKey)+1)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) adminNpmCorrupt(w http.ResponseWriter, _ *http.Request) {
	s.st.setThrottle(npmCorruptKey, 1)
	w.WriteHeader(http.StatusNoContent)
}
