// subjectivity_cite.go —— subjectivity 作为「私有可见性 tier」的 citation 解析。
//
// wiki/output 读了就 cite（进 visitor footer）；subjectivity 读了默认**不** cite——它 ground
// agent 的 voice 但不展示给访客。仅当 owner 把某条 opt-in（show_as_source=true）时才进 footer。
// 这个 gate 是 server-authoritative 的：不信 client 传的 id，逐个反查 show_as_source 再决定。
//
// dialog（写 cited_subjectivity_ids）与 admin transcript（建 subjectivity_refs）都走这里，
// 保证「解析 + gate」一处定义。path 用 parent 链上溯派生（同 deriveNotePath）。

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// SubjectivityCiteRef —— 一条已解析、已通过 show_as_source gate 的 subjectivity 引用。
type SubjectivityCiteRef struct {
	ID           string
	Title        string
	Path         string
	Body         string
	ShowAsSource bool
}

// SubjectivityCiteLookup —— 把 subjectivity id 解析成 (title/path/body/show_as_source) 的窄接口。
// publicroutes 不 import postgres，靠接口传具体实现（NewSubjectivityCiteResolver 包 NoteRepo）。
type SubjectivityCiteLookup interface {
	ResolveCite(ctx context.Context, ownerID, id string) (SubjectivityCiteRef, error)
}

// subjectivityCiteResolver —— SubjectivityCiteLookup 的 postgres 实现：NoteRepo（genre='subjectivity'）
// 反查 note（含 show_as_source）+ parent 链上溯算树派生 path。
type subjectivityCiteResolver struct {
	repo *repo.NoteRepo
}

// NewSubjectivityCiteResolver —— composition root 用：把 subjectivity NoteRepo 包成 lookup。
// repo 为 nil 时返 nil（无 subjectivity 装配的调用方走 no-op resolve）。
//
//nolint:ireturn // nil-safe factory: repo nil 返 nil 接口, 调用方 nil-guard 跳过解析
func NewSubjectivityCiteResolver(notes *repo.NoteRepo) SubjectivityCiteLookup {
	if notes == nil {
		return nil
	}
	return &subjectivityCiteResolver{repo: notes}
}

// ResolveCite —— id → (title/body/show_as_source) + 树派生 path。未命中 → ErrSubjectivityNotFound。
func (r *subjectivityCiteResolver) ResolveCite(
	ctx context.Context, ownerID, id string,
) (SubjectivityCiteRef, error) {
	note, err := r.repo.GetByID(ctx, ownerID, id)
	if err != nil {
		if errors.Is(err, repo.ErrNoteNotFound) {
			return SubjectivityCiteRef{}, entity.ErrSubjectivityNotFound
		}
		return SubjectivityCiteRef{}, fmt.Errorf("get subjectivity: %w", err)
	}
	path, perr := deriveNotePath(ctx, r.repo, ownerID, id)
	if perr != nil {
		return SubjectivityCiteRef{}, fmt.Errorf("derive subjectivity path: %w", perr)
	}
	return SubjectivityCiteRef{
		ID: note.ID, Title: note.Title, Path: path,
		Body: note.Body, ShowAsSource: note.ShowAsSource,
	}, nil
}
