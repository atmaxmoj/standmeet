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
	body, err := os.ReadFile(path)
	if err != nil {
		s.log.Error("read marketplace fixture", "path", path, "err", err)
		http.Error(w, "fixture missing", http.StatusInternalServerError)
		return
	}
	writeJSONBytes(s.log, w, withConnectorNeedingSkill(s.log, body))
}

// needsConnectorSkillID —— 这个目录里唯一一个**要连接器**的技能。
//
// 它是加上去的,不是抓下来的:上游 anthropics/skills 里没有任何技能声明 StandMeet 的工具名,
// 所以「一张卡说得出 needs」这件事在真目录上一次也演不出来(F-F-4)。名字取自设计源里的
// 那个例子(`admin.js` 的 `mp-3 Timezone-aware booking`,blurb 写着 "Extends calendar.book")。
//
// **不写进 fixture 文件**:那份是 `make capture-marketplace-fixtures` 抓的真快照,手加一条
// 会在下次重抓时被静默抹掉,然后守卫红在一个跟它无关的地方。
const needsConnectorSkillID = "tz-booking"

// withConnectorNeedingSkill —— 往抓来的目录里追加那一条。解析不了就原样返回:
// mock 坏掉时该看见的是那条 skill 不见了,不是整个市场空了。
func withConnectorNeedingSkill(log *slog.Logger, listing []byte) []byte {
	var items []map[string]any
	if err := json.Unmarshal(listing, &items); err != nil {
		log.Error("marketplace listing parse", "err", err)
		return listing
	}
	items = append(items, map[string]any{
		"name": needsConnectorSkillID, "type": "dir",
		"html_url": "https://github.com/anthropics/skills/tree/main/skills/" + needsConnectorSkillID,
	})
	out, err := json.Marshal(items)
	if err != nil {
		log.Error("marketplace listing encode", "err", err)
		return listing
	}
	return out
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
		"allowed-tools: [" + mockAllowedTools(id) + "]\n---\n" +
		"Always begin replies with [INSTALLED-SKILL-MARKER]."
}

// mockAllowedTools —— 那一条要连接器的技能声明 booker 的工具,其余都声明检索。
// 检索不依赖任何连接器,所以它们的 needs 是 `[]`(不缺);tz-booking 的是 `[calendar]`
// 直到 owner 把日历连上 —— 一份目录里两种答案,守卫才分得出「不缺」和「没答」。
func mockAllowedTools(id string) string {
	if id == needsConnectorSkillID {
		return "calendar_book"
	}
	return "corpus_search"
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
	writeJSONBytes(log, w, body)
}

func writeJSONBytes(log *slog.Logger, w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(body); werr != nil {
		log.Error("write marketplace fixture", "err", werr)
	}
}
