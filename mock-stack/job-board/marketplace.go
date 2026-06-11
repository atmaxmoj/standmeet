// marketplace.go —— skill-marketplace mock endpoints, served straight
// from disk fixtures. Compose mounts the whole e2e/fixtures tree as
// /fixtures, so the handler reads marketplace/{github,skillsmp.json}
// alongside the job-boards/... fixtures.
//
// Why disk fixtures instead of hardcoded literals: the GitHub repo's
// content is the real upstream and updates over time; `make capture-
// marketplace-fixtures` re-fetches and `trim.sh` trims into the
// committed copy, mirroring the job-board fixture pattern.

package main

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
)

func (s *server) serveMarketplaceGitHub(w http.ResponseWriter, _ *http.Request) {
	path := filepath.Join(s.root, marketSubdir, "github", "contents.json")
	serveFixtureFile(s.log, w, path)
}

func (s *server) serveMarketplaceSkillsMP(w http.ResponseWriter, _ *http.Request) {
	path := filepath.Join(s.root, marketSubdir, "skillsmp.json")
	serveFixtureFile(s.log, w, path)
}

// #48-3 install: serve a SKILL.md so the backend's FetchSkillContent has
// something to fetch + parse. GitHub uses the Contents API (base64); SkillsMP
// a {skill_md} detail body. Synthesized per id, with a marker the install e2e
// can assert composed into a session.
func mockSkillMD(id string) string {
	return "---\nname: " + id + "\ndescription: Installed from the marketplace mock.\n" +
		"allowed-tools: [corpus_search]\n---\n" +
		"Always begin replies with [INSTALLED-SKILL-MARKER]."
}

func (s *server) serveMarketplaceGitHubSkillMD(w http.ResponseWriter, r *http.Request) {
	md := mockSkillMD(r.PathValue("id"))
	writeMarketplaceJSON(s.log, w, map[string]string{
		"content":  base64.StdEncoding.EncodeToString([]byte(md)),
		"encoding": "base64",
	})
}

func (s *server) serveMarketplaceSkillsMPSkillMD(w http.ResponseWriter, r *http.Request) {
	writeMarketplaceJSON(s.log, w, map[string]string{"skill_md": mockSkillMD(r.PathValue("id"))})
}

func writeMarketplaceJSON(log *slog.Logger, w http.ResponseWriter, v map[string]string) {
	body, err := json.Marshal(v)
	if err != nil {
		log.Error("marshal marketplace json", "err", err)
		http.Error(w, "encode error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(body); werr != nil {
		log.Error("write marketplace json", "err", werr)
	}
}

func serveFixtureFile(log *slog.Logger, w http.ResponseWriter, path string) {
	body, err := os.ReadFile(path)
	if err != nil {
		log.Error("read marketplace fixture", "path", path, "err", err)
		http.Error(w, "fixture missing", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(body); werr != nil {
		log.Error("write marketplace fixture", "err", werr)
	}
}
