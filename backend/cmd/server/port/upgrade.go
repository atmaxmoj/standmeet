// upgrade.go —— /admin/system 那个「升级」按钮背后的两件外部事:
//
//	问镜像库还有没有更新的版本   (ReleaseChannel)
//	让编排这台实例的那一方重新部署 (Redeployer)
//
// 两件都在组装根,不在域里:域看见的是两个窄接口,出站 HTTP 和 owner 填的那个 URL
// 都不进 stats 域。
//
// **这台实例没有宿主控制权**:compose 里 backend 刻意不挂 docker.sock。所以升级这件事
// 它自己做不了,只能请编排方做。权限由 owner 亲手给(STANDMEET_REDEPLOY_HOOK),
// 产品不发明它,也不假设编排方是 Coolify 还是别的什么 —— 只认一个不透明的 URL。

package port

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const upgradeHTTPBudget = 15 * time.Second

// ReleaseChannel —— 从 OCI 镜像库读已发布的版本列表(匿名 pull token,公开镜像)。
type ReleaseChannel struct {
	http *http.Client
	base string
	repo string
}

// NewReleaseChannel —— base 是镜像库的根("https://ghcr.io"),repo 形如
// "atmaxmoj/standmeet-backend"。base 可配是为了 dev/e2e 指到本地那个 mock:
// 一条**打公网才成立**的用例,在没网的机器上红得跟产品坏了一模一样。
func NewReleaseChannel(base, repo string) *ReleaseChannel {
	return &ReleaseChannel{
		base: strings.TrimSuffix(base, "/"), repo: repo,
		http: httpx.NewClient(httpx.Options{Timeout: upgradeHTTPBudget}),
	}
}

// LatestVersion —— 已发布里最新的那个**发行版本**。
func (c *ReleaseChannel) LatestVersion(ctx context.Context) (string, error) {
	token, err := c.pullToken(ctx)
	if err != nil {
		return "", err
	}
	tags, err := c.tags(ctx, token)
	if err != nil {
		return "", err
	}
	return newest(tags), nil
}

// Newer —— candidate 比 current 新吗。非发行版本号(比如未盖章的 "dev")一律返 false:
// 拿不准的时候不宣布有新版,而不是反过来。**但"比不了"要另说** —— 见 Released。
func (c *ReleaseChannel) Newer(current, candidate string) bool {
	if !c.Released(current) || !c.Released(candidate) {
		return false
	}
	return compare(current, candidate) < 0
}

// Released —— 这个字符串是个发行版本号吗。"比不了"和"已经最新"是两件事,
// 而 Newer 一个 bool 说不清:未盖章的构建在它眼里跟最新版长得一模一样。
func (*ReleaseChannel) Released(version string) bool {
	return releaseTag.MatchString(version)
}

// pullToken —— 公开镜像的匿名 pull token。没有它 /v2/ 一律 401。
func (c *ReleaseChannel) pullToken(ctx context.Context) (string, error) {
	q := url.Values{"scope": {"repository:" + c.repo + ":pull"}}.Encode()
	res, err := c.okBody(ctx, c.base+"/token?"+q, "")
	if err != nil {
		return "", err
	}
	defer closeBody(res.Body)
	var body struct {
		Token string `json:"token"`
	}
	if derr := json.NewDecoder(res.Body).Decode(&body); derr != nil {
		return "", fmt.Errorf("release channel decode token: %w", derr)
	}
	return body.Token, nil
}

func (c *ReleaseChannel) tags(ctx context.Context, token string) ([]string, error) {
	res, err := c.okBody(ctx, c.base+"/v2/"+c.repo+"/tags/list", token)
	if err != nil {
		return nil, err
	}
	defer closeBody(res.Body)
	var body struct {
		Tags []string `json:"tags"`
	}
	if derr := json.NewDecoder(res.Body).Decode(&body); derr != nil {
		return nil, fmt.Errorf("release channel decode tags: %w", derr)
	}
	return body.Tags, nil
}

// okBody —— 发请求 + 判状态,把还没读的 body 交出来。**解码不在这里**:调用方知道自己
// 要什么形状,而"帮所有人解码"只能靠 any —— 那正是这套代码禁掉它的理由。
func (c *ReleaseChannel) okBody(ctx context.Context, u, token string) (*http.Response, error) {
	res, err := c.get(ctx, u, token)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		closeBody(res.Body)
		return nil, fmt.Errorf("release channel: registry answered %d", res.StatusCode)
	}
	return res, nil
}

// closeBody —— 读完之后关 body 的返回值动不了(连接池无论如何都会回收)。
// 走一个丢弃口而不是 `_ =`,errcheck 认这个;将来要挂遥测也只有这一处要改。
func closeBody(c io.Closer) { discardClose(c.Close()) }

func discardClose(_ error) {}

func (c *ReleaseChannel) get(ctx context.Context, u, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("release channel request: %w", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("release channel: %w", err)
	}
	return res, nil
}

// releaseTag —— 只认 `vN.N.N`。库里还躺着 `latest` 和 `v0.1.1-dirty`
// (`git describe --dirty` 漏出去的那一个) —— 把它们当成版本会让实例宣布一个
// 根本不该存在的"新版"。
var releaseTag = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

// newest —— 按数值比较,不按字典序:字典序下 v0.1.10 排在 v0.1.9 前面。
func newest(tags []string) string {
	var rel []string
	for _, t := range tags {
		if releaseTag.MatchString(t) {
			rel = append(rel, t)
		}
	}
	if len(rel) == 0 {
		return ""
	}
	slices.SortFunc(rel, compare)
	return rel[len(rel)-1]
}

// compare —— a 跟 b 谁旧。负 = a 旧。两边都已经过 releaseTag,所以三段都解析得出。
func compare(a, b string) int {
	pa, pb := parts(a), parts(b)
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] - pb[i]
		}
	}
	return 0
}

// parts —— `v1.2.3` → [1 2 3]。调用方已经过 releaseTag,三段都是纯数字,
// 所以解析不出来这件事在这里不可能发生;真发生了当 0 处理,不让一个坏 tag 拖垮整次比较。
func parts(tag string) [3]int {
	var out [3]int
	for i, s := range strings.SplitN(strings.TrimPrefix(tag, "v"), ".", 3) {
		n, err := strconv.Atoi(s)
		out[i] = zeroOnErr(n, err)
	}
	return out
}

func zeroOnErr(n int, err error) int {
	if err != nil {
		return 0
	}
	return n
}

// ErrRedeployNotConfigured —— owner 没给过重新部署的路。这不是故障:大多数部署方式下
// 升级本来就是在实例外面做的。面板要**照这句话如实说**,不许把按钮画成能按的样子。
var ErrRedeployNotConfigured = errors.New("no redeploy hook configured for this instance")

// Redeployer —— owner 填的那个重新部署 URL。空 = 这台实例没有这条路。
type Redeployer struct {
	http *http.Client
	hook string
}

// NewRedeployer —— 重新部署这条请求**不重试**:编排方那边多半不是幂等的,重打一次
// 可能就是重新部署两次。发一次,结果由浏览器去量。
func NewRedeployer(hook string) *Redeployer {
	return &Redeployer{hook: hook, http: httpx.NewClient(httpx.Options{
		Timeout: upgradeHTTPBudget, NoRetry: true,
	})}
}

// Configured —— owner 给过这条路吗。面板据此决定按钮是「升级」还是「这是你该跑的命令」。
func (r *Redeployer) Configured() bool { return r.hook != "" }

// Trigger —— POST 那个 URL。**只报"打出去了"**:重新部署要几十秒,而且这个进程自己
// 就在被替换的东西里 —— 它活不到能回答"升成功了没有"。真回执由浏览器去量
// (打完轮询 /api/v1/instance 的 version),那一端在重启中活着。
func (r *Redeployer) Trigger(ctx context.Context) error {
	if !r.Configured() {
		return ErrRedeployNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.hook, http.NoBody)
	if err != nil {
		return fmt.Errorf("redeploy request: %w", err)
	}
	res, err := r.http.Do(req)
	if err != nil {
		return fmt.Errorf("redeploy hook: %w", err)
	}
	defer closeBody(res.Body)
	if res.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("redeploy hook answered %d", res.StatusCode)
	}
	return nil
}
