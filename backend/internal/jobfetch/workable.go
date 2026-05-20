// workable.go —— Workable widget API (v1.1，real jobs endpoint TBD)。
//
// 抓取阶段发现 widget endpoint 返的是 account metadata 不是 jobs：
//   GET {base}/api/v1/widget/accounts/{sub}  → {name, description}（无 jobs）
//
// 真 jobs 列表需要不同 endpoint（Workable docs 提到 /api/jobs/spi
// 但要 authed）。这里先实现一个 stub adapter 把 Fetch 永远返
// ErrUpstreamSchema —— v1.1 实现真 endpoint 时直接换。

package jobfetch

import (
	"context"
	"fmt"
	"net/http"

	"github.com/wangsijie/standmeet/internal/domain"
)

const workableDefaultBase = "https://apply.workable.com"

type workableFetcher struct {
	client *http.Client
	base   string
}

func newWorkableFetcher(client *http.Client, envBase string) *workableFetcher {
	return &workableFetcher{
		client: client,
		base:   firstOrDefault(envBase, workableDefaultBase),
	}
}

// Fetch —— v1 stub。register_source kind=workable 还是会过 (validate 通过)，
// fetch_new 调到这里会清楚地报 "Workable adapter not implemented" 而不是
// 静默返空（让 owner 知道这个 kind 还没真接）。
func (f *workableFetcher) Fetch(
	_ context.Context, _ map[string]any,
) ([]domain.FetchedJob, error) {
	return nil, fmt.Errorf(
		"workable adapter is v1.1 stub: widget endpoint 返 metadata only, " +
			"jobs endpoint 待接 (use real fixture company to verify shape)",
	)
}
