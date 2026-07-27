// subjectivity.go —— subjectivity genre 的 usecase：owner 写(建/改)一条自我模型笔记。
// 走通用 NoteRepo（genre='subjectivity'）。parent 校验 + 防环 + 树派生 path 都做成 genre-通用
// （validateNoteParent/…、deriveNotePath），wiki/output 之后收敛到 NoteRepo 时可复用。

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// WriteSubjectivityInput —— subjectivity_write 入参。ID 空 = 建;非空 = 改/改父。
// ShowAsSource：opt 这条 subjectivity 进 visitor cited footer。默认 false（私有）——
// cap 层在 arg 省略时传 false，与 wiki/output 的默认 true 相反。
type WriteSubjectivityInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// SubjectivityResult —— 建/改后返回 id + 树派生 path（供 MCP 回显、访客按 path 寻址）。
type SubjectivityResult struct {
	ID   string
	Path string
}

// DeleteSubjectivity 硬删一条 subjectivity 笔记（子孙经 FK 级联）。
func DeleteSubjectivity(ctx context.Context, deps Deps, ownerID, id string) error {
	if err := deps.Subjectivity.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete subjectivity: %w", err)
	}
	deleteNoteHook(ctx, deps, id)
	return nil
}

// WriteSubjectivity 建或改一条 subjectivity 笔记。
func WriteSubjectivity(
	ctx context.Context, deps Deps, in *WriteSubjectivityInput,
) (SubjectivityResult, error) {
	if in.OwnerID == "" || in.Title == "" {
		return SubjectivityResult{}, apierr.ErrEmptyField
	}
	note, err := writeNote(ctx, deps.Subjectivity, in)
	if err != nil {
		return SubjectivityResult{}, err
	}
	return finishSubjectivityWrite(ctx, deps, in.OwnerID, note.ID, in.Body)
}

// finishSubjectivityWrite —— 写后:重建 `[[X]]` 出度边 + 算树派生 path。拆出让 WriteSubjectivity
// 的 cyclo 不超标。
func finishSubjectivityWrite(
	ctx context.Context, deps Deps, ownerID, id, body string,
) (SubjectivityResult, error) {
	if rerr := RebuildNoteRefs(ctx, deps, ownerID, id, body); rerr != nil {
		return SubjectivityResult{}, fmt.Errorf("rebuild subjectivity refs: %w", rerr)
	}
	indexNoteHook(ctx, deps, ownerID, id)
	path, perr := deriveNotePath(ctx, deps.Subjectivity, ownerID, id)
	if perr != nil {
		return SubjectivityResult{}, fmt.Errorf("derive subjectivity path: %w", perr)
	}
	return SubjectivityResult{ID: id, Path: path}, nil
}

func writeNote(
	ctx context.Context, notes *repo.NoteRepo, in *WriteSubjectivityInput,
) (repo.Note, error) {
	if in.ID == "" {
		return createNote(ctx, notes, in)
	}
	return updateNote(ctx, notes, in)
}

func createNote(
	ctx context.Context, notes *repo.NoteRepo, in *WriteSubjectivityInput,
) (repo.Note, error) {
	if err := validateNoteParent(ctx, notes, in.OwnerID, in.ParentID); err != nil {
		return repo.Note{}, err
	}
	note, err := notes.Create(ctx, &repo.CreateNoteInput{
		OwnerID: in.OwnerID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		CSSClasses: in.CSSClasses, ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return repo.Note{}, fmt.Errorf("create subjectivity: %w", err)
	}
	return note, nil
}

func updateNote(
	ctx context.Context, notes *repo.NoteRepo, in *WriteSubjectivityInput,
) (repo.Note, error) {
	if err := validateNoteReparent(ctx, notes, in.OwnerID, in.ID, in.ParentID); err != nil {
		return repo.Note{}, err
	}
	note, err := notes.UpdateBody(ctx, &repo.UpdateNoteInput{
		OwnerID: in.OwnerID, ID: in.ID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		CSSClasses: in.CSSClasses, ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return repo.Note{}, fmt.Errorf("update subjectivity: %w", err)
	}
	return note, nil
}

// validateNoteParent —— parent 给了就必须是本 owner 同 genre 的一条笔记，否则 ErrParentNotFound。
func validateNoteParent(
	ctx context.Context, notes *repo.NoteRepo, ownerID string, parentID *string,
) error {
	if parentID == nil || *parentID == "" {
		return nil
	}
	if _, err := notes.GetByID(ctx, ownerID, *parentID); err != nil {
		if errors.Is(err, repo.ErrNoteNotFound) {
			return entity.ErrParentNotFound
		}
		return fmt.Errorf("validate note parent: %w", err)
	}
	return nil
}

// validateNoteReparent —— 改父：存在性 + 同 owner + 防环（不能挂到自己/自己的子孙下）。
func validateNoteReparent(
	ctx context.Context, notes *repo.NoteRepo, ownerID, nodeID string, parentID *string,
) error {
	if err := validateNoteParent(ctx, notes, ownerID, parentID); err != nil {
		return err
	}
	if parentID == nil || *parentID == "" {
		return nil
	}
	return checkNoteCycle(ctx, notes, ownerID, nodeID, *parentID)
}

func checkNoteCycle(
	ctx context.Context, notes *repo.NoteRepo, ownerID, nodeID, parentID string,
) error {
	cur := parentID
	for range TreeMaxDepth {
		if cur == nodeID {
			return entity.ErrParentCycle
		}
		n, err := notes.GetByID(ctx, ownerID, cur)
		if err != nil {
			return fmt.Errorf("note cycle check: %w", err)
		}
		if n.ParentID == nil {
			return nil
		}
		cur = *n.ParentID
	}
	return nil
}

// deriveNotePath —— 从笔记沿 parent 链上溯，各段 slug 化 title，拼成树派生 path。
func deriveNotePath(
	ctx context.Context, notes *repo.NoteRepo, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, TreeMaxDepth)
	cur := id
	for range TreeMaxDepth {
		n, err := notes.GetByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("get note for path: %w", err)
		}
		segs = append([]string{PathSegment(n.Title)}, segs...)
		if n.ParentID == nil {
			break
		}
		cur = *n.ParentID
	}
	return strings.Join(segs, "/"), nil
}
