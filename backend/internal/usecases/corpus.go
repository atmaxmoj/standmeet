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
// 再单独调 SEORepo.UpdateWikiPath / WikiRepo.Update 设置（多步写各自原子）。
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
	if err := validatePromoteInput(in); err != nil {
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

func validatePromoteInput(in *PromoteInput) error {
	if in.OwnerID == "" || in.RawID == "" || in.Title == "" {
		return ErrEmptyField
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
