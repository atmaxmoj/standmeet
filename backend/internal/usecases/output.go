// output.go —— raw → wiki → output 三层中"最精炼层"的 promote 路径。
//
// PromoteWikiToOutput：从已 curated 的 wiki 提炼成 output。
// promote 不动 wiki（不像 raw.promoted_to 那种标记）—— 一个 wiki 可能衍生多个
// output，wiki 自己仍可被 chat retrieval 用。output.source_wiki_ids 记反链。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// PromoteToOutputInput —— promote_wiki_to_output 入参。Title 必填（不像 raw→
// wiki 那次 owner 可能想换 title，这里直接复用原 wiki title 也行；owner 的
// AI 客户端往往会重写一遍）。
type PromoteToOutputInput struct {
	OwnerID  string
	WikiID   string
	ParentID *string
	Title    string
	Tags     []string
}

// PromoteWikiToOutput 把指定 wiki 提炼为新 output entry：读 wiki → create
// output 携带 wiki_id 反链。wiki 不动（不像 raw.promoted_to 那种标记）。
func PromoteWikiToOutput(
	ctx context.Context, deps CorpusDeps, in *PromoteToOutputInput,
) (domain.Output, error) {
	if err := validatePromoteToOutputInput(in); err != nil {
		return domain.Output{}, err
	}
	wiki, err := loadWikiForPromote(ctx, deps, in.OwnerID, in.WikiID)
	if err != nil {
		return domain.Output{}, err
	}
	out, err := deps.Output.Create(ctx, &postgres.CreateOutputInput{
		OwnerID:       in.OwnerID,
		ParentID:      in.ParentID,
		Title:         in.Title,
		Body:          wiki.Body(),
		Tags:          mergeTags(wiki.Tags(), in.Tags),
		SourceWikiIDs: []string{wiki.ID()},
	})
	if err != nil {
		return domain.Output{}, fmt.Errorf("output create: %w", err)
	}
	return out, nil
}

func validatePromoteToOutputInput(in *PromoteToOutputInput) error {
	if in.OwnerID == "" || in.WikiID == "" || in.Title == "" {
		return ErrEmptyField
	}
	return nil
}

func loadWikiForPromote(
	ctx context.Context, deps CorpusDeps, ownerID, wikiID string,
) (domain.Wiki, error) {
	wiki, err := deps.Wiki.GetByID(ctx, ownerID, wikiID)
	if err != nil {
		if errors.Is(err, domain.ErrWikiNotFound) {
			return domain.Wiki{}, domain.ErrWikiNotFound
		}
		return domain.Wiki{}, fmt.Errorf("get wiki: %w", err)
	}
	return wiki, nil
}
