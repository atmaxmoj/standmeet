// wire_disp_page.go —— owner 域的主页与对外地址 → 出站收口的窄口。
//
// 主页那份载荷是 join 过的:pin 的 id 连着它在语料里的标题、摘要和地址。以前只有 MCP 那边
// 这么给,面板拿到的是裸 id —— 同一个主页,两个面看到的不是一个东西。

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type pageOps struct {
	owners    *owner.Repo
	pins      owner.PagePinDeps
	handle    owner.HandleDeps
	publicURL owner.PublicURLDeps
}

func newPageOps(d *runtimeDeps) pageOps {
	return pageOps{
		owners:    d.ownerRepo,
		pins:      owner.PagePinDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
		handle:    owner.HandleDeps{Owners: d.ownerRepo},
		publicURL: owner.PublicURLDeps{Owners: d.ownerRepo},
	}
}

func (a pageOps) Get(ctx context.Context, ownerID string) (json.RawMessage, error) {
	content, err := a.contentOrDefault(ctx, ownerID)
	if err != nil {
		return nil, pageErr(err)
	}
	return a.joinedView(ctx, ownerID, &content)
}

func (a pageOps) Put(
	ctx context.Context, ownerID string, body json.RawMessage,
) (json.RawMessage, error) {
	content, err := a.contentOrDefault(ctx, ownerID)
	if err != nil {
		return nil, pageErr(err)
	}
	if uerr := json.Unmarshal(body, &content); uerr != nil {
		//nolint:wrapcheck // 类别错误原样上抛
		return nil, dispatcher.BadInput("invalid page content: " + uerr.Error())
	}
	content.OwnerID = ownerID
	if verr := owner.ValidatePagePins(ctx, a.pins, ownerID, &content); verr != nil {
		return nil, pageErr(verr)
	}
	saved, serr := a.owners.UpsertPageContent(ctx, ownerID, &content)
	if serr != nil {
		return nil, pageErr(serr)
	}
	return a.joinedView(ctx, ownerID, &saved)
}

func (a pageOps) Pinnable(
	ctx context.Context, ownerID string,
) ([]dispatcher.PinCandidate, error) {
	rows, err := owner.ListPinnable(ctx, a.pins, ownerID)
	if err != nil {
		return nil, pageErr(err)
	}
	out := make([]dispatcher.PinCandidate, 0, len(rows))
	for i := range rows {
		out = append(out, dispatcher.PinCandidate{
			ID: rows[i].ID, Title: rows[i].Title, Path: rows[i].Path,
		})
	}
	return out, nil
}

func (a pageOps) Pin(
	ctx context.Context, ownerID, section, wikiID string,
) ([]string, error) {
	pinned, err := owner.PinToPage(ctx, a.pins, ownerID, section, wikiID)
	if err != nil {
		return nil, pageErr(err)
	}
	return pinned, nil
}

func (a pageOps) Unpin(
	ctx context.Context, ownerID, section, wikiID string,
) ([]string, error) {
	pinned, err := owner.UnpinFromPage(ctx, a.pins, ownerID, section, wikiID)
	if err != nil {
		return nil, pageErr(err)
	}
	return pinned, nil
}

func (a pageOps) SetHandle(
	ctx context.Context, ownerID, handle string,
) (dispatcher.OwnerAddress, error) {
	updated, err := owner.UpdateOwnerHandle(ctx, a.handle, ownerID, handle)
	if err != nil {
		return dispatcher.OwnerAddress{}, pageErr(err)
	}
	return toOwnerAddress(&updated), nil
}

func (a pageOps) SetPublicURL(
	ctx context.Context, ownerID, publicURL string,
) (dispatcher.OwnerAddress, error) {
	updated, err := owner.UpdateOwnerPublicURL(ctx, a.publicURL, ownerID, publicURL)
	if err != nil {
		return dispatcher.OwnerAddress{}, pageErr(err)
	}
	return toOwnerAddress(&updated), nil
}

// contentOrDefault —— 第一次访问还没有内容时给一份默认草稿,让 owner 基于它改而不是从空白起步。
func (a pageOps) contentOrDefault(
	ctx context.Context, ownerID string,
) (owner.PageContent, error) {
	content, err := a.owners.GetPageContent(ctx, ownerID)
	if err == nil {
		return content, nil
	}
	if errors.Is(err, owner.ErrPageNotFound) {
		return owner.DefaultPageContent(ownerID), nil
	}
	return owner.PageContent{}, fmt.Errorf("read page content: %w", err)
}

// joinedView —— pin 的 id 连上它在语料里的标题 / 摘要 / 地址。两个面拿到的都是这一份。
func (a pageOps) joinedView(
	ctx context.Context, ownerID string, content *owner.PageContent,
) (json.RawMessage, error) {
	view, err := owner.BuildOwnerPageView(
		ctx, owner.PageDeps{Owners: a.pins.Owners, Wiki: a.pins.Wiki}, ownerID, content,
	)
	if err != nil {
		return nil, pageErr(err)
	}
	out, merr := json.Marshal(&view)
	if merr != nil {
		return nil, fmt.Errorf("encode page view: %w", merr)
	}
	return out, nil
}

func toOwnerAddress(o *owner.Owner) dispatcher.OwnerAddress {
	return dispatcher.OwnerAddress{
		OwnerID: o.ID, Handle: o.Handle, PublicURL: o.PublicURL,
	}
}

func pageErr(err error) error {
	if err == nil {
		return nil
	}
	for _, c := range pageErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	// 校验失败:域已经写好了给人看的话(handle 的字符范围之类),原样带出去 ——
	// 这一层再写一遍就成了第二份文案。
	if errors.Is(err, apierr.ErrEmptyField) {
		//nolint:wrapcheck // 类别错误原样上抛
		return dispatcher.BadInput(err.Error())
	}
	return fmt.Errorf("page op: %w", err)
}

var pageErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{owner.ErrPinUnpublished, func() error {
		return dispatcher.Coded(dispatcher.BadInput(
			"that entry is not published — publish it first, then pin it"), "pin_unpublished")
	}},
	{owner.ErrPinNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("wiki entry not found"), "pin_not_found")
	}},
	{owner.ErrHandleTaken, func() error {
		return dispatcher.Coded(dispatcher.Conflict("handle already taken"), "handle_taken")
	}},
	{owner.ErrPublicURLInvalid, func() error {
		return dispatcher.Coded(dispatcher.BadInput(
			"public_url must be http(s):// with a non-empty host"), "public_url_invalid")
	}},
	{corpus.ErrWikiNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("wiki entry not found"), "pin_not_found")
	}},
}

// 编译期确认:适配器满足收口声明的那个窄口。
var _ dispatcher.PageStore = pageOps{}
