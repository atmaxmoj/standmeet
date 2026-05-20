// remoteok.go —— RemoteOK aggregate JSON。
//
//   GET {base}/api
//
// 返回数组，**index 0 是 legal/attribution 通知**（不是 job！），从 [1:]
// 才是 jobs。每条 { id, slug, position (title), company, location, epoch
// (Unix sec), date (ISO), tags [], apply_url, url, description (HTML) }。
//
// ToS 要求 attribution to RemoteOK on rendered output；我们的用法不再发
// 给 visitor 看（owner private use），attribution 写文档里即可。

package jobfetch

import (
	"context"
	"net/http"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

const remoteOKDefaultBase = "https://remoteok.com"

type remoteOKFetcher struct {
	client *http.Client
	base   string
}

func newRemoteOKFetcher(client *http.Client, envBase string) *remoteOKFetcher {
	return &remoteOKFetcher{
		client: client,
		base:   firstOrDefault(envBase, remoteOKDefaultBase),
	}
}

func (f *remoteOKFetcher) Fetch(
	ctx context.Context, _ map[string]any,
) ([]domain.FetchedJob, error) {
	url := f.base + "/api"
	// API 返个 heterogeneous array：[0] 是 legal notice object（无 id），
	// 后续都是 jobs。最稳的解法是先 unmarshal 成 []map[string]any 再过滤。
	var raw []map[string]any
	if err := getJSON(ctx, f.client, url, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.FetchedJob, 0, len(raw))
	for i := range raw {
		// 跳过 legal notice 元素：没有 "position" 或 "id" 字段的视同非 job
		entry := raw[i]
		idStr, ok := entry["id"].(string)
		if !ok || idStr == "" {
			continue
		}
		position, _ := entry["position"].(string)
		if position == "" {
			continue
		}
		out = append(out, remoteOKToDomain(entry))
	}
	return out, nil
}

func remoteOKToDomain(e map[string]any) domain.FetchedJob {
	tags := []string{}
	if rawTags, ok := e["tags"].([]any); ok {
		for _, t := range rawTags {
			if s, ok := t.(string); ok && s != "" {
				tags = append(tags, s)
			}
		}
	}
	id, _ := e["id"].(string)
	title, _ := e["position"].(string)
	company, _ := e["company"].(string)
	location, _ := e["location"].(string)
	applyURL, _ := e["apply_url"].(string)
	urlStr, _ := e["url"].(string)
	if applyURL == "" {
		applyURL = urlStr
	}
	body, _ := e["description"].(string)

	var published time.Time
	switch v := e["epoch"].(type) {
	case float64:
		published = time.Unix(int64(v), 0)
	case int:
		published = time.Unix(int64(v), 0)
	case int64:
		published = time.Unix(v, 0)
	}
	return domain.FetchedJob{
		ExternalID:  id,
		Title:       title,
		Company:     company,
		Location:    location,
		URL:         applyURL,
		BodyText:    body,
		Tags:        tags,
		PublishedAt: published,
		SourceKind:  KindRemoteOK,
	}
}
