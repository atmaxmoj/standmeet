// jobs.go —— job source 注册、fetch_new、show、discard 的 usecase 层。
//
// 见 docs/design/job-loop.md。这层做：
//   - register/unregister/list source（薄包 postgres）
//   - fetch_new: 调 fetcher → fingerprint dedup → 进 Redis 1d TTL 池子 → 返
//   - show/discard: 走 Redis 池子
//
// reasoning / 排序 / 匹配 是 Claude 在客户端做的事，这里不掺合。

// Package jobsuc —— J.2: 从 internal/usecases 搬过来的 jobs / resume /
// applications use cases。属 jobs plugin 的内部，路径 internal/plugins/
// jobs/jobsuc/。包名 jobsuc (避开跟核心 internal/usecases 撞名)，外部
// 引用形如 jobsuc.JobsDeps。
package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/dedup"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// JobsDeps —— jobs.* usecase 依赖。
type JobsDeps struct {
	Sources  *JobSourceRepo
	Cache    *jobcache.Pool
	Registry *jobfetch.Registry
}

// RegisterJobSource —— 校验 kind/config + 写 postgres。
func RegisterJobSource(
	ctx context.Context, deps JobsDeps, in *jobsmodel.CreateJobSourceInput,
) (jobsmodel.JobSource, error) {
	if err := validateRegisterInput(in); err != nil {
		return jobsmodel.JobSource{}, err
	}
	src, err := deps.Sources.Create(ctx, in)
	if err != nil {
		return jobsmodel.JobSource{}, fmt.Errorf("create source: %w", err)
	}
	return src, nil
}

func validateRegisterInput(in *jobsmodel.CreateJobSourceInput) error {
	if in.OwnerID == "" || in.Kind == "" || in.Label == "" {
		return apierr.ErrEmptyField
	}
	if err := jobfetch.ValidateKindConfig(in.Kind, in.Config); err != nil {
		return fmt.Errorf("validate kind/config: %w", err)
	}
	return nil
}

// ListJobSources —— owner 的全部 source。
func ListJobSources(
	ctx context.Context, deps JobsDeps, ownerID string,
) ([]jobsmodel.JobSource, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	list, err := deps.Sources.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	return list, nil
}

// UnregisterJobSource —— 删 source（cascade 删它的 fingerprints）。
func UnregisterJobSource(
	ctx context.Context, deps JobsDeps, ownerID, sourceID string,
) error {
	if ownerID == "" || sourceID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Sources.Delete(ctx, ownerID, sourceID); err != nil {
		return fmt.Errorf("delete source: %w", err)
	}
	return nil
}

// FetchNewJobs —— 核心。sourceID==nil → 跑 owner 所有 source；
// sourceID 非空 → 跑该 source。返回新 jobs（已 dedup + 已进池子，附 cache_id）
// **以及每个没抓成的源**。
//
// 这里曾经是 `if ferr != nil { return nil, ferr }`，而它上面那行注释写着
// 「单源失败**不阻塞**其他源」—— 注释声明的不变量和下一行代码正好相反。手工驱的时候撞上了：
// 七个源里只有 workable 那个 token 是错的，结果**另外六个真源一条都没进池子**，
// owner 拿到的是一句 `jobs.fetch_new failed`。
//
// 注释比代码更容易被信：读代码的人看到那句话就不会再往下追（[[names-that-lie]]）。
// 现在这个不变量由代码本身成立 —— 每个源自己成败，失败的记进 failures 一起返回。
func FetchNewJobs(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string,
) (FetchResult, error) {
	if ownerID == "" {
		return FetchResult{}, apierr.ErrEmptyField
	}
	sources, err := selectSourcesToFetch(ctx, deps, ownerID, sourceID)
	if err != nil {
		return FetchResult{}, err
	}
	var allNew []jobsmodel.FetchedJob
	var failures []SourceFailure
	var tallies []SourceTally
	for i := range sources {
		run, ferr := fetchOneSourceAndDedup(ctx, deps, &sources[i])
		// 试过就记一笔，**成败都记**。失败的详情以前只活在这次调用的回执里，
		// 关掉窗口就没了，而 /admin/sources 只会说 `never fetched`（F-E-18）。
		markAttempt(ctx, deps, sources[i].ID, ferr)
		if ferr != nil {
			failures = append(failures, failureOf(&sources[i], ferr))
			continue
		}
		allNew = append(allNew, run.jobs...)
		tallies = append(tallies, run.tally)
	}
	// J.6c: 跨源去重 (canonical URL + composite key)。在 fetchOneSourceAndDedup
	// 的 per-source seen-by-external-id 之上再加一层 — 那层只防同一 source
	// 内的重复 post，cross-source 用 ATS namespace 不同的 external_id 就漏。
	// 此处不动 per-source seen 记录 (那条仍按 fetcher 返的 ID 标 seen)，
	// 只对 visible-to-Claude 的 surface 做去重。
	visible := dedup.Apply(allNew)
	return FetchResult{
		Jobs: visible, Failures: failures, Tallies: tallies,
		CrossSourceDropped: len(allNew) - len(visible),
	}, nil
}

// markAttempt —— 把这一次的成败写回源那一行。**写失败本身不算这次取数的失败**：
// owner 已经拿到了岗位（或拿到了失败原因），因为记不下这笔账而把整次调用变成错误，
// 是拿次要的事故盖住主要的结果。写不进去就记日志。
func markAttempt(ctx context.Context, deps JobsDeps, sourceID string, ferr error) {
	// 存的是**给人看的那一句**，不是整条错误链 —— 那一行会原样渲在 /admin/sources 上，
	// 而链条前面两截是源 uuid 和内部动词，对 owner 没有用（UX-77）。
	// 完整的链仍然在 `SourceFailure.Reason` 里交给 owner 的 AI，也在日志里。
	reason := ""
	if ferr != nil {
		reason = sourceFailureSentence(ferr)
	}
	if merr := deps.Sources.MarkAttempt(ctx, sourceID, reason); merr != nil {
		slog.WarnContext(ctx, "job source attempt not recorded",
			"source", sourceID, "err", merr)
	}
}

func selectSourcesToFetch(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string,
) ([]jobsmodel.JobSource, error) {
	if sourceID != nil && *sourceID != "" {
		src, err := deps.Sources.GetByID(ctx, ownerID, *sourceID)
		if err != nil {
			return nil, fmt.Errorf("get source by id: %w", err)
		}
		return []jobsmodel.JobSource{src}, nil
	}
	list, err := deps.Sources.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	return list, nil
}

func fetchOneSourceAndDedup(
	ctx context.Context, deps JobsDeps, src *jobsmodel.JobSource,
) (sourceRun, error) {
	acc, err := fetchAndStampSourceID(ctx, deps, src)
	if err != nil {
		return sourceRun{}, err
	}
	newJobs, err := keepUnseen(ctx, deps, src.ID, acc.Jobs)
	if err != nil {
		return sourceRun{}, err
	}
	pooled, err := persistNewJobs(ctx, deps, src, newJobs)
	if err != nil {
		return sourceRun{}, err
	}
	return sourceRun{jobs: pooled, tally: SourceTally{
		SourceID: src.ID, Label: src.Label, Kind: src.Kind,
		Seen: len(acc.Jobs), Pooled: len(pooled), Duplicate: len(acc.Jobs) - len(newJobs),
		// adapter 自己那一层的账（逐条取的源才有）：上游一共多少、我们看了多少、
		// 按原因跳过多少、是不是撞上限截断了。
		Available: acc.Available, Read: acc.Read,
		Skipped: acc.Skipped, Truncated: acc.Truncated,
	}}, nil
}

func persistNewJobs(
	ctx context.Context, deps JobsDeps, src *jobsmodel.JobSource, newJobs []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	if len(newJobs) == 0 {
		return nil, touchSource(ctx, deps, src.ID)
	}
	withCache, err := deps.Cache.Put(ctx, src.OwnerID, newJobs)
	if err != nil {
		return nil, fmt.Errorf("cache put: %w", err)
	}
	if rerr := recordSeenAndTouch(ctx, deps, src.ID, withCache); rerr != nil {
		return nil, rerr
	}
	return withCache, nil
}

func fetchAndStampSourceID(
	ctx context.Context, deps JobsDeps, src *jobsmodel.JobSource,
) (jobfetch.Accounted, error) {
	acc, err := deps.Registry.FetchAccounted(ctx, src.Kind, src.Config)
	if err != nil {
		return jobfetch.Accounted{}, fmt.Errorf("fetch source %s: %w", src.ID, err)
	}
	for i := range acc.Jobs {
		acc.Jobs[i].SourceID = src.ID
	}
	return acc, nil
}

func keepUnseen(
	ctx context.Context, deps JobsDeps, sourceID string, raw []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	unseen, err := deps.Sources.FilterUnseenExternalIDs(ctx, sourceID, externalIDsOf(raw))
	if err != nil {
		return nil, fmt.Errorf("filter unseen: %w", err)
	}
	return pickByIDSet(raw, unseen), nil
}

func externalIDsOf(raw []jobsmodel.FetchedJob) []string {
	out := make([]string, 0, len(raw))
	for i := range raw {
		out = append(out, raw[i].ExternalID)
	}
	return out
}

func pickByIDSet(raw []jobsmodel.FetchedJob, allowed []string) []jobsmodel.FetchedJob {
	set := make(map[string]struct{}, len(allowed))
	for _, e := range allowed {
		set[e] = struct{}{}
	}
	out := raw[:0]
	for i := range raw {
		if _, ok := set[raw[i].ExternalID]; ok {
			out = append(out, raw[i])
		}
	}
	return out
}

func recordSeenAndTouch(
	ctx context.Context, deps JobsDeps, sourceID string, jobs []jobsmodel.FetchedJob,
) error {
	newIDs := make([]string, 0, len(jobs))
	for i := range jobs {
		newIDs = append(newIDs, jobs[i].ExternalID)
	}
	if err := deps.Sources.RecordSeenExternalIDs(ctx, sourceID, newIDs); err != nil {
		return fmt.Errorf("record fingerprints: %w", err)
	}
	return touchSource(ctx, deps, sourceID)
}

func touchSource(ctx context.Context, deps JobsDeps, sourceID string) error {
	if err := deps.Sources.TouchFetched(ctx, sourceID); err != nil {
		return fmt.Errorf("touch: %w", err)
	}
	return nil
}

// ShowJob —— 池子里反查；过期 / discard 后返 ErrJobCacheMiss。
func ShowJob(
	ctx context.Context, deps JobsDeps, ownerID, cacheID string,
) (jobsmodel.FetchedJob, error) {
	if ownerID == "" || cacheID == "" {
		return jobsmodel.FetchedJob{}, apierr.ErrEmptyField
	}
	job, err := deps.Cache.Get(ctx, ownerID, cacheID)
	if err != nil {
		if errors.Is(err, jobcache.ErrCacheMiss) {
			return jobsmodel.FetchedJob{}, jobsmodel.ErrJobCacheMiss
		}
		return jobsmodel.FetchedJob{}, fmt.Errorf("cache get: %w", err)
	}
	return job, nil
}

// DiscardJob —— 主动让一条 job 退出 owner 视野。
func DiscardJob(ctx context.Context, deps JobsDeps, ownerID, cacheID string) error {
	if ownerID == "" || cacheID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Cache.Discard(ctx, ownerID, cacheID); err != nil {
		return fmt.Errorf("cache discard: %w", err)
	}
	return nil
}
