// Package dedup —— J.6c: 跨源去重。
//
// 同一岗位被 owner 多个 source 同时返 (e.g. JBA 聚合里有 Anthropic + owner
// 也注册了 Anthropic 的 Greenhouse) 实际工作流见过多次。fetcher 自己内部
// 只看 external_id 不能跨 ATS dedup —— Greenhouse 的 id "7726627003" 跟 JBA
// 的 url "https://boards.greenhouse.io/affirm/jobs/7726627003" 是两个 namespace
// 但指同一岗位。本包做 cross-source 层面的去重，由 usecase 在所有 source
// fetch 完一轮、append 完结果之后调一次 Apply。
//
// 设计参考 [[job-loop-2026-05]] memory 的 3-layer 方案：
//
//	L1: canonical URL  (lowercase scheme+host+path, strip query / 末尾 /)
//	L2: composite key  (normalize(company) :: normalize(title) :: bucket(location))
//	L3: 语义 embedding (留 hook，本 commit 不实现)
//
// 策略：单 pass 走 input，对每条同时算 L1 + L2；任一已经见过就 drop。
// 第一次遇到的留下 (Apply 不重排 input；caller 已经按 source 注册顺序 fan-in，
// 第一个 source 赢)。
//
// 不持久化 — 纯函数。
package dedup

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// Apply —— 输入 fetched job list, 返回 cross-source dedup 后的子集。保
// 持原顺序。input 为 nil / empty 时直接返回。caller 负责 input 已经按"想
// 让谁先赢"的顺序排好 (source 注册顺序 = ListByOwner 顺序就行)。
func Apply(jobs []jobsmodel.FetchedJob) []jobsmodel.FetchedJob {
	if len(jobs) == 0 {
		return jobs
	}
	seenURL := make(map[string]struct{}, len(jobs))
	seenComposite := make(map[string]struct{}, len(jobs))
	out := make([]jobsmodel.FetchedJob, 0, len(jobs))
	for i := range jobs {
		if dropDuplicate(&jobs[i], seenURL, seenComposite) {
			continue
		}
		out = append(out, jobs[i])
	}
	return out
}

// dropDuplicate —— 单条决策：L1 / L2 任一已见就丢；否则两个 set 都记一笔。
// 拆出来让 Apply 的 cognitive complexity ≤ 5。
func dropDuplicate(
	j *jobsmodel.FetchedJob,
	seenURL, seenComposite map[string]struct{},
) bool {
	if k := canonicalURL(j.URL); k != "" {
		if _, ok := seenURL[k]; ok {
			return true
		}
		seenURL[k] = struct{}{}
	}
	if k := compositeKey(j); k != "" {
		if _, ok := seenComposite[k]; ok {
			return true
		}
		seenComposite[k] = struct{}{}
	}
	return false
}

// canonicalURL —— scheme + host + path (lowercase, strip query / fragment /
// 末尾 /)。解不开 / 空 url 返 ""，上游用 "" 当 "不参与 L1 dedup"。
//
// 真实碰撞场景：JBA 把 Greenhouse 抓的 absolute_url 透传出来，跟 owner
// 直接注册的 Greenhouse source 自己拉到的 absolute_url 一字不差。L1 就抓
// 这条直球。
func canonicalURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	path := strings.TrimRight(u.Path, "/")
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host) + path
}

// compositeKey —— normalize(company) "::" normalize(title) "::" bucket(location)。
// 三段任一空就视同 "" 整条 L2 不参与；其余都按 normalize 后比较。
//
// 触发场景：JBA 透传的 Greenhouse 跟 owner 自己的 Greenhouse company / title 一字不差，
// 但 URL 末尾 query string 带 gh_jid 微差 —— L1 漏了，L2 兜底。
func compositeKey(j *jobsmodel.FetchedJob) string {
	co := normalizeCompany(j.Company)
	ti := normalizeTitle(j.Title)
	if co == "" || ti == "" {
		return ""
	}
	return co + "::" + ti + "::" + bucketLocation(j.Location)
}

// normalizeCompany —— lowercase + drop common legal suffix。
// "Acme Rockets, Inc." → "acme rockets"; "Beta Labs LLC" → "beta labs"。
// 故意 conservative：不展开"&" → "and" 这种太激进的；只动明确的法人后缀。
func normalizeCompany(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = companyJunkRE.ReplaceAllString(s, "")
	return collapseSpaces(s)
}

// normalizeTitle —— lowercase + 去 paren 内补充 (e.g. "(US Remote)") +
// collapse whitespace + 去前后标点。不去 seniority 关键词 (Senior/Staff
// 是分级，不是噪声)。
func normalizeTitle(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = titleParenRE.ReplaceAllString(s, " ")
	return collapseSpaces(s)
}

// bucketLocation —— 取逗号前第一段 + lowercase (e.g. "San Francisco, CA" →
// "san francisco"; "Remote (US)" → "remote (us)" → 经 normalize 应当被截断
// 到 "remote")。空 location 返 "" — L2 仍 fire (空 location 不区分时同
// title+company 视同同岗位)。
func bucketLocation(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if i := strings.Index(s, ","); i > 0 {
		s = s[:i]
	}
	// 简化处理 "remote (us)" → "remote"，让 RemoteOK + JBA 的不同 location
	// 写法都收口到同一个 bucket。
	if i := strings.Index(s, "("); i > 0 {
		s = strings.TrimSpace(s[:i])
	}
	return collapseSpaces(s)
}

func collapseSpaces(s string) string {
	return collapseSpacesRE.ReplaceAllString(strings.TrimSpace(s), " ")
}

// 法人后缀 regex；多个 suffix 用 alternation。允许前面带逗号 / 空格、
// 末尾可能带句号。
var companyJunkRE = regexp.MustCompile(
	`[,]?\s*\b(inc|incorporated|llc|ltd|limited|` +
		`co|corp|corporation|gmbh|sa|plc)\b\.?`,
)

// titleParenRE —— 整个 "(...)" 段，包括括号 + 内容。
var titleParenRE = regexp.MustCompile(`\([^)]*\)`)

// collapseSpacesRE —— 多个 whitespace 收成单 space。
var collapseSpacesRE = regexp.MustCompile(`\s+`)
