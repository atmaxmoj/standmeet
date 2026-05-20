// jobs.go —— job source 注册、fetch_new、show、discard 的 usecase 层。
//
// 见 docs/design/job-loop.md。这层做：
//   - register/unregister/list source（薄包 postgres）
//   - fetch_new: 调 fetcher → fingerprint dedup → 进 Redis 1d TTL 池子 → 返
//   - show/discard: 走 Redis 池子
//
// reasoning / 排序 / 匹配 是 Claude 在客户端做的事，这里不掺合。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/jobcache"
	"github.com/wangsijie/standmeet/internal/jobfetch"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// JobsDeps —— jobs.* usecase 依赖。
type JobsDeps struct {
	Sources  *postgres.JobSourceRepo
	Cache    *jobcache.Pool
	Registry *jobfetch.Registry
}

// RegisterJobSource —— 校验 kind/config + 写 postgres。
func RegisterJobSource(
	ctx context.Context, deps JobsDeps, in *domain.CreateJobSourceInput,
) (domain.JobSource, error) {
	if in.OwnerID == "" || in.Kind == "" || in.Label == "" {
		return domain.JobSource{}, ErrEmptyField
	}
	if err := jobfetch.ValidateKindConfig(in.Kind, in.Config); err != nil {
		return domain.JobSource{}, err
	}
	src, err := deps.Sources.Create(ctx, in)
	if err != nil {
		return domain.JobSource{}, fmt.Errorf("create source: %w", err)
	}
	return src, nil
}

// ListJobSources —— owner 的全部 source。
func ListJobSources(
	ctx context.Context, deps JobsDeps, ownerID string,
) ([]domain.JobSource, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
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
		return ErrEmptyField
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
) ([]domain.FetchedJob, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	sources, err := selectSourcesToFetch(ctx, deps, ownerID, sourceID)
	if err != nil {
		return nil, err
	}
	var allNew []domain.FetchedJob
	for i := range sources {
		nu, ferr := fetchOneSourceAndDedup(ctx, deps, &sources[i])
		if ferr != nil {
			// 单源失败不阻塞其他源；caller 看 error 自己决定（这里聚合返）。
			return nil, ferr
		}
		allNew = append(allNew, nu...)
	}
	return allNew, nil
}

func selectSourcesToFetch(
	ctx context.Context, deps JobsDeps, ownerID string, sourceID *string,
) ([]domain.JobSource, error) {
	if sourceID != nil && *sourceID != "" {
		src, err := deps.Sources.GetByID(ctx, ownerID, *sourceID)
		if err != nil {
			return nil, err
		}
		return []domain.JobSource{src}, nil
	}
	return deps.Sources.ListByOwner(ctx, ownerID)
}

func fetchOneSourceAndDedup(
	ctx context.Context, deps JobsDeps, src *domain.JobSource,
) ([]domain.FetchedJob, error) {
	raw, err := deps.Registry.Fetch(ctx, src.Kind, src.Config)
	if err != nil {
		return nil, fmt.Errorf("fetch source %s: %w", src.ID, err)
	}
	// fill source_id (fetcher 自己不知道)
	for i := range raw {
		raw[i].SourceID = src.ID
	}
	// dedup against fingerprints
	candidates := make([]string, 0, len(raw))
	for i := range raw {
		candidates = append(candidates, raw[i].ExternalID)
	}
	unseen, err := deps.Sources.FilterUnseenExternalIDs(ctx, src.ID, candidates)
	if err != nil {
		return nil, fmt.Errorf("filter unseen: %w", err)
	}
	unseenSet := make(map[string]struct{}, len(unseen))
	for _, e := range unseen {
		unseenSet[e] = struct{}{}
	}
	newJobs := raw[:0]
	for i := range raw {
		if _, ok := unseenSet[raw[i].ExternalID]; ok {
			newJobs = append(newJobs, raw[i])
		}
	}
	if len(newJobs) == 0 {
		// 仍然 touch fetched timestamp + record empty fingerprint 没意义
		if terr := deps.Sources.TouchFetched(ctx, src.ID); terr != nil {
			return nil, fmt.Errorf("touch: %w", terr)
		}
		return nil, nil
	}
	// 进 Redis 池子（分配 cache_id）
	withCache, err := deps.Cache.Put(ctx, src.OwnerID, newJobs)
	if err != nil {
		return nil, fmt.Errorf("cache put: %w", err)
	}
	// 落 fingerprint（下次 dedup 命中）
	newIDs := make([]string, 0, len(withCache))
	for _, j := range withCache {
		newIDs = append(newIDs, j.ExternalID)
	}
	if rerr := deps.Sources.RecordSeenExternalIDs(ctx, src.ID, newIDs); rerr != nil {
		return nil, fmt.Errorf("record fingerprints: %w", rerr)
	}
	if terr := deps.Sources.TouchFetched(ctx, src.ID); terr != nil {
		return nil, fmt.Errorf("touch: %w", terr)
	}
	return withCache, nil
}

// ShowJob —— 池子里反查；过期 / discard 后返 ErrJobCacheMiss。
func ShowJob(
	ctx context.Context, deps JobsDeps, ownerID, cacheID string,
) (domain.FetchedJob, error) {
	if ownerID == "" || cacheID == "" {
		return domain.FetchedJob{}, ErrEmptyField
	}
	job, err := deps.Cache.Get(ctx, ownerID, cacheID)
	if err != nil {
		if errors.Is(err, jobcache.ErrCacheMiss) {
			return domain.FetchedJob{}, domain.ErrJobCacheMiss
		}
		return domain.FetchedJob{}, fmt.Errorf("cache get: %w", err)
	}
	return job, nil
}

// DiscardJob —— 主动让一条 job 退出 owner 视野。
func DiscardJob(ctx context.Context, deps JobsDeps, ownerID, cacheID string) error {
	if ownerID == "" || cacheID == "" {
		return ErrEmptyField
	}
	if err := deps.Cache.Discard(ctx, ownerID, cacheID); err != nil {
		return fmt.Errorf("cache discard: %w", err)
	}
	return nil
}
