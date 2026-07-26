// corpus.go —— raw / wiki use cases。
// 当前实现 RawDump + PromoteToWiki + List。其余 (UploadMedia / SetTags 等)
// 等真用到再加。

package corpus

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/apierr"
)

// Deps —— raw + wiki + output + path 操作需要的 repo 集合。
type Deps struct {
	Raw          *RawRepo
	Wiki         *WikiRepo
	Output       *OutputRepo
	NoteRefs     *NoteRefRepo
	Subjectivity *NoteRepo
	VaultSync    *VaultSyncRepo // Obsidian vault sync: 跨-genre reconcile(仅 admin 侧装配)
	Index        Indexer        // Meili 索引传播;nil = 未配 Meili,写路径不索引(best-effort)
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
func RawDump(ctx context.Context, deps Deps, in *RawDumpInput) (Raw, error) {
	if in.OwnerID == "" || in.Body == "" {
		return Raw{}, apierr.ErrEmptyField
	}
	src := in.Source
	if src == "" {
		src = "mcp"
	}
	raw, err := deps.Raw.Create(ctx, &CreateRawInput{
		OwnerID:        in.OwnerID,
		Body:           in.Body,
		Source:         src,
		Tags:           in.Tags,
		FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return Raw{}, fmt.Errorf("raw create: %w", err)
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
	ctx context.Context, deps Deps, in *PromoteInput,
) (Wiki, error) {
	if err := preflightPromote(ctx, deps, in); err != nil {
		return Wiki{}, err
	}
	raw, err := loadRawForPromote(ctx, deps, in)
	if err != nil {
		return Wiki{}, err
	}
	wiki, err := deps.Wiki.Create(ctx, &CreateWikiInput{
		OwnerID:      in.OwnerID,
		ParentID:     in.ParentID,
		Title:        in.Title,
		Body:         raw.Body(),
		Tags:         mergeTags(raw.Tags(), in.Tags),
		SourceRawIDs: []string{raw.ID()},
	})
	if err != nil {
		return Wiki{}, fmt.Errorf("wiki create: %w", err)
	}
	fin := promoteFinish{OwnerID: in.OwnerID, RawID: raw.ID(), WikiID: wiki.ID(), Body: raw.Body()}
	if perr := finishPromote(ctx, deps, fin); perr != nil {
		return Wiki{}, perr
	}
	return wiki, nil
}

// promoteFinish —— finishPromote 入参打包(避免 argument-limit 超 5)。
type promoteFinish struct {
	OwnerID string
	RawID   string
	WikiID  string
	Body    string
}

// finishPromote —— mark raw promoted + 重建这条 wiki 的 [[X]] 出度边。body 用
// raw.Body()(Create 返回的 wiki 不一定回填 body)。合一处让 PromoteToWiki cyclo 不超标。
func finishPromote(ctx context.Context, deps Deps, f promoteFinish) error {
	if perr := deps.Raw.MarkPromoted(ctx, f.OwnerID, f.RawID, f.WikiID); perr != nil {
		return fmt.Errorf("mark promoted: %w", perr)
	}
	if rerr := RebuildNoteRefs(ctx, deps, f.OwnerID, f.WikiID, f.Body); rerr != nil {
		return rerr
	}
	indexNoteHook(ctx, deps, f.OwnerID, f.WikiID)
	return nil
}

// preflightPromote —— promote 前的三道关:必填字段 + parent 合法 + 同 slug 兄弟
// 不撞。合在一处让 PromoteToWiki 的 cyclo 不超标。
func preflightPromote(ctx context.Context, deps Deps, in *PromoteInput) error {
	if err := validatePromoteInput(in); err != nil {
		return err
	}
	if err := validateWikiParent(ctx, deps, in.OwnerID, in.ParentID); err != nil {
		return err
	}
	return ensureSiblingSlugFree(ctx, deps, siblingSlugCheck{
		OwnerID: in.OwnerID, ParentID: in.ParentID, Title: in.Title,
	})
}

// siblingScanLimit —— 撞名检查扫同一 parent 下的兄弟。一个目录下手工 curate 的
// 文档不会上千;给个宽上限一次扫完(不翻页),够覆盖任何现实树。
const siblingScanLimit = 10_000

// siblingSlugCheck —— ensureSiblingSlugFree 入参打包(避免 argument-limit 超 5)。
// ExcludeID 给 update 自查用:改名成自己当前的 slug 不算撞,空表示纯新建。
type siblingSlugCheck struct {
	OwnerID   string
	ParentID  *string
	Title     string
	ExcludeID string
}

// ensureSiblingSlugFree —— Obsidian 语义的写时撞名防护:同一 parent(含 root)下
// 不允许两条 title slug 相同的兄弟,否则地址 path 不再 1↔1。slug 不入库(树派生),
// 没法在 SQL 里按 slug 查 → 取该 parent 的兄弟在 Go 里比 PathSegment。撞 →
// ErrSiblingSlugTaken。
func ensureSiblingSlugFree(ctx context.Context, deps Deps, c siblingSlugCheck) error {
	slug := PathSegment(c.Title)
	sibs, err := deps.Wiki.ListChildren(ctx, c.OwnerID, c.ParentID, siblingScanLimit, 0)
	if err != nil {
		return fmt.Errorf("list siblings for slug check: %w", err)
	}
	for i := range sibs {
		if sibs[i].ID == c.ExcludeID {
			continue
		}
		if PathSegment(sibs[i].Title) == slug {
			return ErrSiblingSlugTaken
		}
	}
	return nil
}

func validatePromoteInput(in *PromoteInput) error {
	if in.OwnerID == "" || in.RawID == "" || in.Title == "" {
		return apierr.ErrEmptyField
	}
	return nil
}

// validateWikiParent —— parent_id 给了就必须是本 owner 的 wiki(FK 只保证 id
// 存在于 corpus_notes,不管 owner;跨 owner 父会绕过)。找不到 → ErrParentNotFound,
// 不允许挂无效父落孤儿。空 parent(root)放行。
func validateWikiParent(
	ctx context.Context, deps Deps, ownerID string, parentID *string,
) error {
	if parentID == nil || *parentID == "" {
		return nil
	}
	if _, err := deps.Wiki.GetByID(ctx, ownerID, *parentID); err != nil {
		if errors.Is(err, ErrWikiNotFound) {
			return ErrParentNotFound
		}
		return fmt.Errorf("validate wiki parent: %w", err)
	}
	return nil
}

// validateWikiReparent —— UpdateWiki 改 parent 用:存在性 + 同 owner
// (validateWikiParent)+ 防环(不能把 nodeID 挂到自己或自己的子孙下)。
func validateWikiReparent(
	ctx context.Context, deps Deps, ownerID, nodeID string, parentID *string,
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
	ctx context.Context, deps Deps, ownerID, nodeID, parentID string,
) error {
	cur := parentID
	for range TreeMaxDepth {
		if cur == nodeID {
			return ErrParentCycle
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
	ctx context.Context, deps Deps, in *PromoteInput,
) (Raw, error) {
	raw, err := deps.Raw.GetByID(ctx, in.OwnerID, in.RawID)
	if err != nil {
		if errors.Is(err, ErrRawNotFound) {
			return Raw{}, ErrRawNotFound
		}
		return Raw{}, fmt.Errorf("get raw: %w", err)
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
