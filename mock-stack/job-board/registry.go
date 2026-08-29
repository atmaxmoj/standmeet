// registry.go —— OCI 镜像库的两个端点(匿名 pull token + tag 列表),给 /admin/system
// 那一格「有没有新版」用。真实对象是 ghcr.io;dev/e2e 把 STANDMEET_RELEASE_REGISTRY
// 指到这里,免得一条用例的成败取决于机器有没有公网。
//
// 替身要照着真 registry 的规矩答,不是照着我们方便答([[stand-in-is-politer-than-reality]]):
//   · 没带 Bearer 的 /v2/ 请求回 401 —— 真 ghcr 就是这样,而"匿名也能读"会让
//     "忘了取 token"这条缺陷在 e2e 里永远暴露不出来。
//   · tag 列表里混着 `latest` 和一个 `-dirty` 尾巴 —— 真库里就有这两样
//     (`git describe --dirty` 漏出去过一次),它们正是"把非发行 tag 当成新版"的诱饵。

package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

// mockRegistryToken —— 替身发的那个 token。/v2/ 只认这一个。
const mockRegistryToken = "mock-pull-token"

// mockRegistryTags —— 替身宣称已发布的版本。`v9.9.9` 比任何真版本都新,
// 于是"有新版可升"这一态在 e2e 里稳定可达,不随真实发布节奏漂。
var mockRegistryTags = []string{
	"v0.0.9", "latest", "v0.1.0", "v0.1.4-dirty", "v0.1.4", "v9.9.9",
}

func (s *server) serveRegistryToken(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("scope") == "" {
		http.Error(w, "scope is required", http.StatusBadRequest)
		return
	}
	writeRegistryJSON(s.log, w, map[string]any{"token": mockRegistryToken})
}

func (s *server) serveRegistryTags(w http.ResponseWriter, r *http.Request) {
	if !strings.HasSuffix(r.Header.Get("Authorization"), mockRegistryToken) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeRegistryJSON(s.log, w, map[string]any{"name": "standmeet", "tags": mockRegistryTags})
}

func writeRegistryJSON(log *slog.Logger, w http.ResponseWriter, body map[string]any) {
	raw, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "encode", http.StatusInternalServerError)
		return
	}
	writeJSONBytes(log, w, raw)
}
