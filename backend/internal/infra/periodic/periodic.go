// Package periodic —— 进程里的周期任务:一份调度,谁都不再自己写循环。
//
// 在这之前每个周期任务都自带一整套:一个 ticker goroutine、一个 boot 时先跑一次、一对
// Register/Report 的簿记、两个常量(间隔 + 一句给面板看的 "every 5m")。抄了三遍,于是:
//
//   - 那句 schedule 是**手写**的,跟真正的间隔各存一份 —— 它可以说 "every 5m" 而实际每小时
//     跑一次,面板照样理直气壮。这里由间隔**算出来**,少一处能说谎的地方。
//   - 少写一句 Register,这个任务就从 Monitor 面板上消失,而它照跑不误。corpus 的 Meili
//     reconcile 循环就是这样:一直在跑,面板上从来没有过它。
//
// 分工是固定的:**做什么**由声明它的那一方给(域 / 插件 / 轴自己的机制);**多久做一次、以及
// 簿记**归宿主。声明是数据,跟 OwnerTools / Config / HostOps 同一个套路。
package periodic

import (
	"context"
	"log/slog"
	"strconv"
	"time"
)

// Run —— 任务真正做的事。返回 error → 这一轮记 "error",循环继续(一次失败不停表)。
type Run func(ctx context.Context) error

// Job —— 一个周期任务的声明。
type Job struct {
	Run   Run
	Name  string // Monitor 面板上的身份,如 "resume-draft sweep"
	Every time.Duration
}

// Board —— 簿记面(stats 的 JobRegistry 满足它)。声明方不认识 stats。
type Board interface {
	Register(name, schedule string)
	Report(name, status string)
}

// Start —— 登记 + boot 先跑一遍(让 last_run 立刻有确定值)+ 起周期循环。
// ctx 取消(进程退出)即停。Every ≤ 0 的任务跳过并记日志:那是声明写错了,不是"跑得很快"。
func Start(ctx context.Context, board Board, log *slog.Logger, jobs []Job) {
	for i := range jobs {
		job := jobs[i]
		if job.Every <= 0 {
			log.Error("periodic job has no interval — not scheduled", "job", job.Name)
			continue
		}
		board.Register(job.Name, scheduleOf(job.Every))
		runOnce(ctx, board, log, &job)
		go loop(ctx, board, log, job)
	}
}

// scheduleOf —— 面板上那句话由间隔算出来,不是另写一份。
//
// Duration.String() 会给 "1h0m0s" 这种,面板上读着刺眼;把整段的零头去掉 → "1h" / "5m"。
// 只是显示,不改语义 —— 间隔仍然只有 Every 那一个来源。
func scheduleOf(every time.Duration) string {
	return "every " + tidyDuration(every)
}

// tidyDuration —— 整小时 → "1h",整分 → "5m",其余原样。
func tidyDuration(d time.Duration) string {
	switch {
	case d%time.Hour == 0:
		return strconv.Itoa(int(d/time.Hour)) + "h"
	case d%time.Minute == 0:
		return strconv.Itoa(int(d/time.Minute)) + "m"
	default:
		return d.String()
	}
}

func loop(ctx context.Context, board Board, log *slog.Logger, job Job) {
	ticker := time.NewTicker(job.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce(ctx, board, log, &job)
		}
	}
}

func runOnce(ctx context.Context, board Board, log *slog.Logger, job *Job) {
	if err := job.Run(ctx); err != nil {
		board.Report(job.Name, "error")
		log.Warn("periodic job", "job", job.Name, "err", err)
		return
	}
	board.Report(job.Name, "ok")
}

// Named —— 声明一个任务的简写,省得每个声明点重复三行字段名。
func Named(name string, every time.Duration, run Run) Job {
	return Job{Name: name, Every: every, Run: run}
}

// Wrap —— 把一个不返回 error 的动作包成 Run(如只记日志的 best-effort 重建)。
func Wrap(fn func(ctx context.Context)) Run {
	return func(ctx context.Context) error {
		fn(ctx)
		return nil
	}
}
