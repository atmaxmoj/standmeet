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

	jobcache "github.com/atmaxmoj/standmeet/internal/plugins/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/dedup"
	jobfetch "github.com/atmaxmoj/standmeet/internal/plugins/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// JobsDeps —— jobs.* usecase 依赖。
type JobsDeps struct {
	Sources  *postgres.JobSourceRepo
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
		return usecases.ErrEmptyField
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
		return nil, usecases.ErrEmptyField
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
		return usecases.ErrEmptyField
	}
	if err := deps.Sources.Delete(ctx, ownerID, sourceID); err != nil {
		return fmt.Errorf("delete source: %w", err)
	}
	return nil
}

// FetchNewJobs —— 核心。sourceID==nil → 跑 owner 所有 source；
// sourceID 非空 → 跑该 source。返回新 jobs（已 dedup + 已进池子，附 cache_id）。
func FetchNewJobs(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string,
) ([]jobsmodel.FetchedJob, error) {
	if ownerID == "" {
		return nil, usecases.ErrEmptyField
	}
	sources, err := selectSourcesToFetch(ctx, deps, ownerID, sourceID)
	if err != nil {
		return nil, err
	}
	var allNew []jobsmodel.FetchedJob
	for i := range sources {
		nu, ferr := fetchOneSourceAndDedup(ctx, deps, &sources[i])
		if ferr != nil {
			// 单源失败不阻塞其他源；caller 看 error 自己决定（这里聚合返）。
			return nil, ferr
		}
		allNew = append(allNew, nu...)
	}
	// J.6c: 跨源去重 (canonical URL + composite key)。在 fetchOneSourceAndDedup
	// 的 per-source seen-by-external-id 之上再加一层 — 那层只防同一 source
	// 内的重复 post，cross-source 用 ATS namespace 不同的 external_id 就漏。
	// 此处不动 per-source seen 记录 (那条仍按 fetcher 返的 ID 标 seen)，
	// 只对 visible-to-Claude 的 surface 做去重。
	return dedup.Apply(allNew), nil
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
) ([]jobsmodel.FetchedJob, error) {
	raw, err := fetchAndStampSourceID(ctx, deps, src)
	if err != nil {
		return nil, err
	}
	newJobs, err := keepUnseen(ctx, deps, src.ID, raw)
	if err != nil {
		return nil, err
	}
	return persistNewJobs(ctx, deps, src, newJobs)
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
) ([]jobsmodel.FetchedJob, error) {
	raw, err := deps.Registry.Fetch(ctx, src.Kind, src.Config)
	if err != nil {
		return nil, fmt.Errorf("fetch source %s: %w", src.ID, err)
	}
	for i := range raw {
		raw[i].SourceID = src.ID
	}
	return raw, nil
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
		return jobsmodel.FetchedJob{}, usecases.ErrEmptyField
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
		return usecases.ErrEmptyField
	}
	if err := deps.Cache.Discard(ctx, ownerID, cacheID); err != nil {
		return fmt.Errorf("cache discard: %w", err)
	}
	return nil
}
