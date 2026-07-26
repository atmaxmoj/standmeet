// corpus_crud.go —— admin UI 调的 corpus 三层 Update / Delete / Create wiki+output
// 入口。raw 的 Update 走"改 body + tags + private"；wiki / output 的 Update
// 改 title/body/tags/parent/show_as_source。Create wiki / output 是给 owner 在
// admin UI 起一条新条目（不从 raw promote）；source 字段为空。
// retrieval-redesign：visibility 字段全部砍掉；path / show_as_source 落地
// 在 SEORepo.UpdateWikiSEO / UpdateOutputSEO 和这里的 ShowAsSource 字段。

package corpus

import (
	"context"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/apierr"
)

// ─── raw ────────────────────────────────────────────────────

// UpdateRawReq —— admin 改 raw 入参。
type UpdateRawReq struct {
	OwnerID        string
	ID             string
	Body           string
	Tags           []string
	FlaggedPrivate bool
}

// UpdateRaw 改 raw_entries 的 body + tags + flagged_private。
func UpdateRaw(
	ctx context.Context, deps Deps, in *UpdateRawReq,
) (Raw, error) {
	if in.OwnerID == "" || in.ID == "" || in.Body == "" {
		return Raw{}, apierr.ErrEmptyField
	}
	raw, err := deps.Raw.UpdateBody(ctx, &UpdateRawInput{
		OwnerID: in.OwnerID, ID: in.ID,
		Body: in.Body, Tags: in.Tags, FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return Raw{}, fmt.Errorf("update raw: %w", err)
	}
	return raw, nil
}

// ArchiveRaw 软删一条 raw。
func ArchiveRaw(ctx context.Context, deps Deps, ownerID, rawID string) error {
	if ownerID == "" || rawID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Raw.Archive(ctx, ownerID, rawID); err != nil {
		return fmt.Errorf("archive raw: %w", err)
	}
	return nil
}

// ─── wiki ───────────────────────────────────────────────────

// CreateWikiReq —— admin 直接起一条 wiki（不 promote）。SourceRawIDs 空。
type CreateWikiReq struct {
	OwnerID  string
	ParentID *string
	Title    string
	Body     string
	Tags     []string
}

// CreateWiki 起一条新 wiki（admin UI"+new wiki"按钮的入口）。
func CreateWiki(
	ctx context.Context, deps Deps, in *CreateWikiReq,
) (Wiki, error) {
	if err := preflightCreateWiki(ctx, deps, in); err != nil {
		return Wiki{}, err
	}
	wiki, err := deps.Wiki.Create(ctx, &CreateWikiInput{
		OwnerID:  in.OwnerID,
		ParentID: in.ParentID,
		Title:    in.Title,
		Body:     in.Body,
		Tags:     in.Tags,
	})
	if err != nil {
		return Wiki{}, fmt.Errorf("create wiki: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, wiki.ID(), in.Body); rerr != nil {
		return Wiki{}, rerr
	}
	return wiki, nil
}

// preflightCreateWiki —— create 前两道关:必填字段 + parent 合法。合在一处让
// CreateWiki 的 cyclo 不超标。
func preflightCreateWiki(ctx context.Context, deps Deps, in *CreateWikiReq) error {
	if in.OwnerID == "" || in.Title == "" || in.Body == "" {
		return apierr.ErrEmptyField
	}
	return validateWikiParent(ctx, deps, in.OwnerID, in.ParentID)
}

// UpdateWikiReq —— admin 改 wiki 入参。
type UpdateWikiReq struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// UpdateWiki 改 wiki 主字段。
func UpdateWiki(
	ctx context.Context, deps Deps, in *UpdateWikiReq,
) (Wiki, error) {
	if err := preflightUpdateWiki(ctx, deps, in); err != nil {
		return Wiki{}, err
	}
	wiki, err := deps.Wiki.Update(ctx, &UpdateWikiInput{
		OwnerID: in.OwnerID, ID: in.ID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ShowAsSource: in.ShowAsSource, CSSClasses: in.CSSClasses,
	})
	if err != nil {
		return Wiki{}, fmt.Errorf("update wiki: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, wiki.ID(), in.Body); rerr != nil {
		return Wiki{}, rerr
	}
	indexNoteHook(ctx, deps, in.OwnerID, wiki.ID())
	return wiki, nil
}

// preflightUpdateWiki —— UpdateWiki 前三道关:必填字段 + reparent 合法(存在/同
// owner/防环)+ 同 slug 兄弟不撞(改名/改 parent 都可能撞,排除自己)。合一处让
// UpdateWiki 的 cyclo 不超标。
func preflightUpdateWiki(ctx context.Context, deps Deps, in *UpdateWikiReq) error {
	if hasBlankCorpusField(in.OwnerID, in.ID, in.Title, in.Body) {
		return apierr.ErrEmptyField
	}
	if err := validateWikiReparent(ctx, deps, in.OwnerID, in.ID, in.ParentID); err != nil {
		return err
	}
	return ensureSiblingSlugFree(ctx, deps, siblingSlugCheck{
		OwnerID: in.OwnerID, ParentID: in.ParentID, Title: in.Title, ExcludeID: in.ID,
	})
}

// hasBlankCorpusField —— UpdateWiki / UpdateOutput 共用的"必填字段空"检查。
func hasBlankCorpusField(vals ...string) bool {
	return slices.Contains(vals, "")
}

// DeleteWiki 硬删一条 wiki。
func DeleteWiki(ctx context.Context, deps Deps, ownerID, wikiID string) error {
	if ownerID == "" || wikiID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Wiki.Delete(ctx, ownerID, wikiID); err != nil {
		return fmt.Errorf("delete wiki: %w", err)
	}
	deleteNoteHook(ctx, deps, wikiID)
	return nil
}

// ─── output ─────────────────────────────────────────────────

// CreateOutputReq —— admin 直接起一条 output（不 promote）。SourceWikiIDs 空。
type CreateOutputReq struct {
	OwnerID  string
	ParentID *string
	Title    string
	Body     string
	Tags     []string
}

// CreateOutput 起一条新 output（admin UI"+new output"按钮的入口）。
func CreateOutput(
	ctx context.Context, deps Deps, in *CreateOutputReq,
) (Output, error) {
	if in.OwnerID == "" || in.Title == "" || in.Body == "" {
		return Output{}, apierr.ErrEmptyField
	}
	out, err := deps.Output.Create(ctx, &CreateOutputInput{
		OwnerID:  in.OwnerID,
		ParentID: in.ParentID,
		Title:    in.Title,
		Body:     in.Body,
		Tags:     in.Tags,
	})
	if err != nil {
		return Output{}, fmt.Errorf("create output: %w", err)
	}
	return out, nil
}

// UpdateOutputReq —— admin 改 output 入参。
type UpdateOutputReq struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	ShowAsSource bool
}

// UpdateOutput 改 output 主字段。
func UpdateOutput(
	ctx context.Context, deps Deps, in *UpdateOutputReq,
) (Output, error) {
	if hasBlankCorpusField(in.OwnerID, in.ID, in.Title, in.Body) {
		return Output{}, apierr.ErrEmptyField
	}
	out, err := deps.Output.Update(ctx, &UpdateOutputInput{
		OwnerID: in.OwnerID, ID: in.ID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return Output{}, fmt.Errorf("update output: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, out.ID(), in.Body); rerr != nil {
		return Output{}, fmt.Errorf("rebuild output refs: %w", rerr)
	}
	indexNoteHook(ctx, deps, in.OwnerID, out.ID())
	return out, nil
}

// DeleteOutput 硬删一条 output。
func DeleteOutput(ctx context.Context, deps Deps, ownerID, outputID string) error {
	if ownerID == "" || outputID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Output.Delete(ctx, ownerID, outputID); err != nil {
		return fmt.Errorf("delete output: %w", err)
	}
	deleteNoteHook(ctx, deps, outputID)
	return nil
}
