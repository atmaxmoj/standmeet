// wire_disp_custom_pages.go —— owner 域的自定义页 → 出站收口的窄口。

package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type customPageOps struct {
	pages owner.CustomPageDeps
}

func newCustomPageOps(d *runtimeDeps) customPageOps {
	return customPageOps{
		pages: owner.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
	}
}

func (a customPageOps) List(
	ctx context.Context, ownerID string,
) ([]dispatcher.CustomPage, error) {
	rows, err := owner.ListPages(ctx, a.pages, ownerID)
	if err != nil {
		return nil, customPageErr(err)
	}
	out := make([]dispatcher.CustomPage, 0, len(rows))
	for i := range rows {
		out = append(out, toDispatcherCustomPage(&rows[i]))
	}
	return out, nil
}

// Create —— 不给标题就用 slug 当标题(owner 建页时通常只想到地址)。
func (a customPageOps) Create(
	ctx context.Context, ownerID, slug, title string,
) (dispatcher.CustomPage, error) {
	if title == "" {
		title = slug
	}
	page, err := owner.CreatePage(ctx, a.pages, &owner.CreatePageInput{
		OwnerID: ownerID, Slug: slug, Title: title,
	})
	if err != nil {
		return dispatcher.CustomPage{}, customPageErr(err)
	}
	return toDispatcherCustomPage(&page), nil
}

func (a customPageOps) WriteFile(
	ctx context.Context, ownerID, slug, path, content string,
) (dispatcher.CustomPageBuild, error) {
	build, err := owner.WriteFile(ctx, a.pages, &owner.WriteFileInput{
		OwnerID: ownerID, Slug: slug, Path: path, Content: content,
	})
	if err != nil {
		return dispatcher.CustomPageBuild{}, customPageErr(err)
	}
	return toDispatcherBuild(&build), nil
}

func (a customPageOps) Build(
	ctx context.Context, ownerID, slug string,
) (dispatcher.CustomPageBuild, error) {
	build, err := owner.Build(ctx, a.pages, ownerID, slug)
	if err != nil {
		return dispatcher.CustomPageBuild{}, customPageErr(err)
	}
	return toDispatcherBuild(&build), nil
}

func (a customPageOps) GetBuild(
	ctx context.Context, buildID string,
) (dispatcher.CustomPageBuild, error) {
	build, err := owner.GetBuild(ctx, a.pages, buildID)
	if err != nil {
		return dispatcher.CustomPageBuild{}, customPageErr(err)
	}
	return toDispatcherBuild(&build), nil
}

func (a customPageOps) PromoteToStaging(
	ctx context.Context, ownerID, slug, buildID string,
) (dispatcher.CustomPage, error) {
	return a.promote(ctx, owner.PromoteToStaging, ownerID, slug, buildID)
}

func (a customPageOps) PromoteToLive(
	ctx context.Context, ownerID, slug, buildID string,
) (dispatcher.CustomPage, error) {
	return a.promote(ctx, owner.PromoteToLive, ownerID, slug, buildID)
}

func (a customPageOps) Rollback(
	ctx context.Context, ownerID, slug string,
) (dispatcher.CustomPage, error) {
	page, err := owner.Rollback(ctx, a.pages, ownerID, slug)
	if err != nil {
		return dispatcher.CustomPage{}, customPageErr(err)
	}
	return toDispatcherCustomPage(&page), nil
}

func (a customPageOps) Delete(ctx context.Context, ownerID, slug string) error {
	return customPageErr(owner.DeletePage(ctx, a.pages, ownerID, slug))
}

// promoteFn —— 域里那两个提升函数的形状(staging / live)。
type promoteFn func(
	ctx context.Context, deps owner.CustomPageDeps, ownerID, slug, buildID string,
) (owner.CustomPage, error)

// promote —— staging / live 只差调哪个域函数。
func (a customPageOps) promote(
	ctx context.Context, apply promoteFn, ownerID, slug, buildID string,
) (dispatcher.CustomPage, error) {
	page, err := apply(ctx, a.pages, ownerID, slug, buildID)
	if err != nil {
		return dispatcher.CustomPage{}, customPageErr(err)
	}
	return toDispatcherCustomPage(&page), nil
}

func toDispatcherCustomPage(p *owner.CustomPage) dispatcher.CustomPage {
	v := dispatcher.CustomPage{
		ID: p.ID, Slug: p.Slug, Title: p.Title, Status: p.Status,
		HasLive: p.LiveBuildID != nil, HasStaging: p.StagingBuildID != nil,
		CreatedAt: p.CreatedAt.Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt.Format(time.RFC3339),
	}
	if p.LiveBuildID != nil {
		v.LiveBuildID = *p.LiveBuildID
	}
	return v
}

func toDispatcherBuild(b *owner.CustomPageBuild) dispatcher.CustomPageBuild {
	return dispatcher.CustomPageBuild{
		BuildID: b.ID, PageID: b.PageID, Status: b.Status,
		OutputPath: b.OutputPath, ErrorMessage: b.ErrorMessage,
	}
}

func customPageErr(err error) error {
	if err == nil {
		return nil
	}
	for _, c := range customPageErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fmt.Errorf("custom page op: %w", err)
}

var customPageErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{owner.ErrCustomPageNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("page not found"), "page_not_found")
	}},
	{owner.ErrCustomPageBuildNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("build not found"), "build_not_found")
	}},
	{owner.ErrCustomPageSlugTaken, func() error {
		return dispatcher.Coded(dispatcher.Conflict("slug already taken"), "slug_taken")
	}},
}

// 编译期确认:适配器满足收口声明的那个窄口。
var _ dispatcher.CustomPageStore = customPageOps{}
