// cap_jobs_fetch.go —— `jobs.fetch_new` 这一个工具：它的声明、它的入参、它的处理器。
//
// 从 cap_jobs.go 分出来，是因为这个工具的**回执形状**跟其余五个不是一件事：
// 另外五个是薄包（注册一个源、按 id 取一条、删一条），而这一个要同时回答
// 「今天的板子长什么样」和「这一趟取数发生了什么」两个问题，于是入参、窗口判定、
// 三份账的组装都长在这里。改这一处的影响面跟改那五个不一样。

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

func (c *jobsCapability) fetchNewBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "jobs.fetch_new",
		Description: "Poll one or all registered sources, then return the whole live job " +
			"pool for the window — not only what this call happened to add. Each row " +
			"carries cache_id, ttl_remaining_seconds, and new=true when this call " +
			"pooled it. Rows are headlines only; call jobs.show(cache_id) for the JD body. " +
			"Ask twice in a day and you get the same board back, not an empty list. " +
			"since_hours narrows the window; the pool's own TTL is 24h, so a larger " +
			"value returns the same board.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"source_id":{"type":"string",
					"description":"Optional specific source id (omit = all sources)."},
				"since_hours":{"type":"number",
					"description":"Hours back the pool reaches (default 24 = its own TTL)."}
			}
		}`),
		Handler: c.handleFetchNew,
	}
}

// fetchNewArgsWire —— `since_hours` 用指针：**没给**和**给了 0** 不是一回事。
// 没给 = 用默认的 24 小时；给了 0 或负数 = 一个空窗口，那是笔误，要当场说出来，
// 不能悄悄当成"整个池子"（[[empty-is-not-json-null]]）。
type fetchNewArgsWire struct {
	SinceHours *float64 `json:"since_hours"`
	SourceID   string   `json:"source_id"`
}

const defaultPoolWindow = 24 * time.Hour

var errSinceHoursNotPositive = errors.New(
	"since_hours must be greater than 0 — omit it for the default 24h window")

// source —— 空串 = 没指定，跑全部源。
func (a *fetchNewArgsWire) source() *string {
	if a.SourceID == "" {
		return nil
	}
	s := a.SourceID
	return &s
}

func (a *fetchNewArgsWire) window() (time.Duration, error) {
	if a.SinceHours == nil {
		return defaultPoolWindow, nil
	}
	if *a.SinceHours <= 0 {
		return 0, errSinceHoursNotPositive
	}
	return time.Duration(*a.SinceHours * float64(time.Hour)), nil
}

func (c *jobsCapability) handleFetchNew(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args fetchNewArgsWire
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return capreg.MCPError("invalid arguments: " + err.Error())
		}
	}
	since, serr := args.window()
	if serr != nil {
		return capreg.MCPError(serr.Error())
	}
	res, err := jobsuc.FetchNewJobs(ctx, *c.jobs, ownerID, args.source(), since)
	if err != nil {
		return jobsCapErrToResult(c.log, err, "fetch_new")
	}
	// failures 跟 jobs 一起返回,**不是**换成一个 error:一个源的错 token 不该把另外六个源
	// 抓到的东西扔掉。owner 需要同时知道「拿到了什么」和「哪个源没成、为什么」。
	//
	// `sources` 那份账是第三件必需品：光看 jobs 的条数，**读不出**「HN 回了 1 条」是
	// 今天真没人招、还是取数一路失败被静默跳过（F-E-19）。每个源报 seen/pooled/duplicate，
	// 再加一个跨源去重挡掉了几条 —— 判据 check 2 问的正是最后那个数。
	//
	// 而 `jobs` 那一份是**池子这个窗口的全部**，不是这一趟新捞的那几条：后者只是前者里
	// 带 `new` 的子集。少了这一点，owner 一天里问第二次就只能拿到一个空数组（F-E-29）。
	return mcputil.MarshalResult(c.log, "jobs.fetch_new", map[string]any{
		"jobs":                 poolRowViews(res.Jobs),
		"failed_sources":       res.Failures,
		"sources":              res.Tallies,
		"cross_source_dropped": res.CrossSourceDropped,
	})
}
