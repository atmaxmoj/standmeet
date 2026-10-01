// npm_fixtures.go — plain npm packages for the "a microsite uses a package we did not ship" e2e
// (e2e/test/microsite-wrapped-package.spec.ts). Unlike npm.go's demo they carry no block manifest:
// they are what a block's `package:` names, installed by a real `npm install` against this mock.
//
//   - sm-fixture-pristine: its postinstall rewrites index.js. A page that reads "PRISTINE" proves
//     the install ran no scripts.
//   - sm-fixture-font: a stylesheet and the font file it points at.

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha512"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"net/http"
)

//go:embed testdata/fixture.woff2
var fixtureWoff2 []byte

const npmFixtureVersion = "1.0.0"

// npmFixtures — package name → its files (paths under package/).
var npmFixtures = map[string]map[string][]byte{
	"sm-fixture-pristine": {
		"package.json": []byte(`{"name":"sm-fixture-pristine","version":"1.0.0","type":"module",` +
			`"main":"index.js","scripts":{"postinstall":"node -e \"require('fs').writeFileSync(` +
			`'index.js','export default \\\"POSTINSTALL_RAN\\\";')\""}}`),
		"index.js": []byte(`export default "PRISTINE";` + "\n"),
	},
	"sm-fixture-font": {
		"package.json": []byte(`{"name":"sm-fixture-font","version":"1.0.0","style":"index.css"}`),
		"index.css": []byte(`@font-face{font-family:'SMFixtureFace';src:url('./fixture.woff2') format('woff2')}` +
			"\n" + `.sm-fixture{font-family:'SMFixtureFace',monospace;color:rgb(17, 34, 51)}` + "\n"),
		"fixture.woff2": fixtureWoff2,
	},
}

// npmFixtureTarball — deterministic bytes (gzip header carries no time), so the integrity in the
// package document matches what the tarball route serves.
func (s *server) npmFixtureTarball(name string) []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, f := range []string{"package.json", "index.js", "index.css", "fixture.woff2"} {
		if body, ok := npmFixtures[name][f]; ok {
			writeTarFile(s.log, tw, "package/"+f, string(body))
		}
	}
	closeTar(s.log, tw, gz)
	return buf.Bytes()
}

// serveNpmFixtureDoc — the package document npm reads before it fetches the tarball.
func (s *server) serveNpmFixtureDoc(w http.ResponseWriter, r *http.Request, name string) {
	sum := sha512.Sum512(s.npmFixtureTarball(name))
	// The version entry is the package.json itself: npm decides whether a package has install
	// scripts from this document, not from the tarball (hasInstallScript, scripts).
	version := map[string]any{}
	if err := json.Unmarshal(npmFixtures[name]["package.json"], &version); err != nil {
		s.log.Error("npm fixture package.json", "name", name, "err", err)
	}
	if _, ok := version["scripts"]; ok {
		version["hasInstallScript"] = true
	}
	version["dist"] = map[string]any{
		"tarball":   "http://" + r.Host + "/npm/tarball/" + name,
		"integrity": "sha512-" + base64.StdEncoding.EncodeToString(sum[:]),
	}
	doc := map[string]any{
		"_id": name, "name": name,
		"dist-tags": map[string]any{"latest": npmFixtureVersion},
		"versions":  map[string]any{npmFixtureVersion: version},
	}
	writeJSONBytes(s.log, w, mustJSON(s.log, doc))
}
