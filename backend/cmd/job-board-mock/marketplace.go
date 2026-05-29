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
