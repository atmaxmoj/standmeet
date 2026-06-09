// corpus.go —— raw / wiki use cases。
// 当前实现 RawDump + PromoteToWiki + List。其余 (UploadMedia / SetTags 等)
// 等真用到再加。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// CorpusDeps —— raw + wiki + output + path 操作需要的 repo 集合。
type CorpusDeps struct {
	Raw    *postgres.RawRepo
	Wiki   *postgres.WikiRepo
	Output *postgres.OutputRepo
}

// RawDumpInput 是 raw_dump 入参。
type RawDumpInput struct {
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
}

// RawDump 写一条新 raw_entries。MCP 工具调它；source label 由 owner 的 AI 客户端给。
func RawDump(ctx context.Context, deps CorpusDeps, in *RawDumpInput) (domain.Raw, error) {
	if in.OwnerID == "" || in.Body == "" {
		return domain.Raw{}, ErrEmptyField
	}
	src := in.Source
	if src == "" {
		src = "mcp"
	}
	raw, err := deps.Raw.Create(ctx, &postgres.CreateRawInput{
		OwnerID:        in.OwnerID,
		Body:           in.Body,
		Source:         src,
		Tags:           in.Tags,
		FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return domain.Raw{}, fmt.Errorf("raw create: %w", err)
	}
	return raw, nil
}

// PromoteInput 是 promote_to_wiki 入参。
//
// path / show_as_source 不在这层 —— MCP 工具层接 path 后调 PromoteToWiki
// 再单独调 SEORepo.UpdateWikiSEO / WikiRepo.Update 设置（多步写各自原子）。
type PromoteInput struct {
	OwnerID  string
	RawID    string
	ParentID *string
	Title    string
	Tags     []string
}

// PromoteToWiki 把指定 raw 提升为新 wiki entry：读原 raw → create wiki
// 携带 raw_id 反链 → mark raw promoted_to。
func PromoteToWiki(
	ctx context.Context, deps CorpusDeps, in *PromoteInput,
) (domain.Wiki, error) {
	if err := preflightPromote(ctx, deps, in); err != nil {
		return domain.Wiki{}, err
	}
	raw, err := loadRawForPromote(ctx, deps, in)
	if err != nil {
		return domain.Wiki{}, err
	}
	wiki, err := deps.Wiki.Create(ctx, &postgres.CreateWikiInput{
		OwnerID:      in.OwnerID,
		ParentID:     in.ParentID,
		Title:        in.Title,
		Body:         raw.Body(),
		Tags:         mergeTags(raw.Tags(), in.Tags),
		SourceRawIDs: []string{raw.ID()},
	})
	if err != nil {
		return domain.Wiki{}, fmt.Errorf("wiki create: %w", err)
	}
	if perr := deps.Raw.MarkPromoted(ctx, in.OwnerID, raw.ID(), wiki.ID()); perr != nil {
		return domain.Wiki{}, fmt.Errorf("mark promoted: %w", perr)
	}
	return wiki, nil
}

// preflightPromote —— promote 前的两道关:必填字段 + parent 合法。合在一处让
// PromoteToWiki 的 cyclo 不超标。
func preflightPromote(ctx context.Context, deps CorpusDeps, in *PromoteInput) error {
	if err := validatePromoteInput(in); err != nil {
		return err
	}
	return validateWikiParent(ctx, deps, in.OwnerID, in.ParentID)
}

func validatePromoteInput(in *PromoteInput) error {
	if in.OwnerID == "" || in.RawID == "" || in.Title == "" {
		return ErrEmptyField
	}
	return nil
}

// validateWikiParent —— parent_id 给了就必须是本 owner 的 wiki(FK 只保证 id
// 存在于 wiki_entries,不管 owner;跨 owner 父会绕过)。找不到 → ErrParentNotFound,
// 不允许挂无效父落孤儿。空 parent(root)放行。
func validateWikiParent(
	ctx context.Context, deps CorpusDeps, ownerID string, parentID *string,
) error {
	if parentID == nil || *parentID == "" {
		return nil
	}
	if _, err := deps.Wiki.GetByID(ctx, ownerID, *parentID); err != nil {
		if errors.Is(err, domain.ErrWikiNotFound) {
			return domain.ErrParentNotFound
		}
		return fmt.Errorf("validate wiki parent: %w", err)
	}
	return nil
}

// validateWikiReparent —— UpdateWiki 改 parent 用:存在性 + 同 owner
// (validateWikiParent)+ 防环(不能把 nodeID 挂到自己或自己的子孙下)。
func validateWikiReparent(
	ctx context.Context, deps CorpusDeps, ownerID, nodeID string, parentID *string,
) error {
	if err := validateWikiParent(ctx, deps, ownerID, parentID); err != nil {
		return err
	}
	if parentID == nil || *parentID == "" {
		return nil
	}
	return checkNoParentCycle(ctx, deps, ownerID, nodeID, *parentID)
}

// checkNoParentCycle —— 从拟定 parent 沿 parent 链上溯到根,路上撞到 nodeID 就
// 是环(把节点挂到了自己 / 自己的子孙下)→ ErrParentCycle。
func checkNoParentCycle(
	ctx context.Context, deps CorpusDeps, ownerID, nodeID, parentID string,
) error {
	cur := parentID
	for range treeMaxDepth {
		if cur == nodeID {
			return domain.ErrParentCycle
		}
		w, err := deps.Wiki.GetByID(ctx, ownerID, cur)
		if err != nil {
			return fmt.Errorf("cycle check: %w", err)
		}
		pid, ok := w.ParentID()
		if !ok {
			return nil
		}
		cur = pid
	}
	return nil
}

func loadRawForPromote(
	ctx context.Context, deps CorpusDeps, in *PromoteInput,
) (domain.Raw, error) {
	raw, err := deps.Raw.GetByID(ctx, in.OwnerID, in.RawID)
	if err != nil {
		if errors.Is(err, domain.ErrRawNotFound) {
			return domain.Raw{}, domain.ErrRawNotFound
		}
		return domain.Raw{}, fmt.Errorf("get raw: %w", err)
	}
	return raw, nil
}

// mergeTags 把 raw.tags 和 promote 时指定的 extra tags 合并去重（顺序保留）。
func mergeTags(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	appendUnique(&out, seen, a)
	appendUnique(&out, seen, b)
	return out
}

func appendUnique(out *[]string, seen map[string]bool, in []string) {
	for _, t := range in {
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		*out = append(*out, t)
	}
}
