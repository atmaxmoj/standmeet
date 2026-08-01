// wire_disp_writings.go —— corpus 域的长文 → 出站收口的窄口。
//
// 素材 URL 的解析在这里:它要拿存储客户端(签名 / 过期都是存储那侧的事),收口不该知道。
// 解不出就给空表 —— 一篇文章的配图取不到地址,不该让整份列表打不开。

package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

const writingPreviewMaxLen = 200

type writingOps struct {
	writings corpus.WritingsDeps
	tx       corpus.WritingsTxDeps
	log      *slog.Logger
}

func newWritingOps(d *runtimeDeps) writingOps {
	return writingOps{
		writings: corpus.WritingsDeps{Writings: d.writingRepo},
		tx: corpus.WritingsTxDeps{
			Writings:    d.writingRepo,
			WritingRefs: d.writingRefRepo,
			Assets:      corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		},
		log: d.log,
	}
}

func (a writingOps) List(
	ctx context.Context, ownerID string,
) ([]dispatcher.Writing, error) {
	rows, err := corpus.ListAllWritings(ctx, a.writings, ownerID)
	if err != nil {
		return nil, writingErr(err)
	}
	out := make([]dispatcher.Writing, 0, len(rows))
	for i := range rows {
		out = append(out, a.toDispatcherWriting(ctx, &rows[i]))
	}
	return out, nil
}

func (a writingOps) Publish(
	ctx context.Context, ownerID, writingID string,
) (dispatcher.Writing, error) {
	return a.applyPublish(ctx, corpus.PublishWriting, ownerID, writingID)
}

func (a writingOps) Unpublish(
	ctx context.Context, ownerID, writingID string,
) (dispatcher.Writing, error) {
	return a.applyPublish(ctx, corpus.UnpublishWriting, ownerID, writingID)
}

func (a writingOps) Delete(ctx context.Context, ownerID, writingID string) error {
	return writingErr(corpus.DeleteWritingWithAssets(ctx, a.tx, ownerID, writingID))
}

// applyPublish —— 两个方向只差调哪个域函数,回包形状同一份。
func (a writingOps) applyPublish(
	ctx context.Context,
	apply func(context.Context, corpus.WritingsDeps, string, string) (corpus.Writing, error),
	ownerID, writingID string,
) (dispatcher.Writing, error) {
	wg, err := apply(ctx, a.writings, ownerID, writingID)
	if err != nil {
		return dispatcher.Writing{}, writingErr(err)
	}
	return a.toDispatcherWriting(ctx, &wg), nil
}

// toDispatcherWriting —— 域实体 → 收口形状,外加配图的可访问地址。
func (a writingOps) toDispatcherWriting(
	ctx context.Context, wg *corpus.Writing,
) dispatcher.Writing {
	parentID, _ := wg.ParentID()
	return dispatcher.Writing{
		ID: wg.ID(), Slug: wg.Slug(), Title: wg.Title(), Excerpt: wg.Excerpt(),
		BodyMD:        wg.Body(),
		Preview:       corpus.LeadLine(wg.Body(), writingPreviewMaxLen),
		CoverHeadline: wg.CoverHeadline(), CoverHue: wg.CoverHue(),
		CoverImageAssetID: wg.CoverImageAssetID(),
		Tags:              wg.Tags(), Visibility: wg.VisibilityMode(),
		CrossRefs: wg.CrossRefs(), Path: wg.Path(),
		ReadMinutes: wg.ReadMinutes(), LockedBody: wg.LockedBody(),
		ParentID:    parentID,
		Published:   wg.IsPublished(),
		PublishedAt: publishedAtOf(wg),
		CreatedAt:   wg.CreatedAt().Format(time.RFC3339),
		UpdatedAt:   wg.UpdatedAt().Format(time.RFC3339),
		AssetURLs:   a.assetURLs(ctx, wg),
	}
}

func publishedAtOf(wg *corpus.Writing) string {
	pub, ok := wg.PublishedAt()
	if !ok {
		return ""
	}
	return corpus.PublishedAtRFC3339(&pub)
}

// assetURLs —— 正文和封面引用的素材 → 可访问地址。取不到给空表,不搅黄这条记录。
func (a writingOps) assetURLs(ctx context.Context, wg *corpus.Writing) map[string]string {
	var coverPtr *string
	if cover := wg.CoverImageAssetID(); cover != "" {
		coverPtr = &cover
	}
	urls, err := corpus.ResolveAssetURLs(
		ctx, a.tx.Assets.Repo, a.tx.Assets.Storage,
		corpus.WritingAssetIDs(wg.Body(), coverPtr),
	)
	if err != nil {
		a.log.Error("resolve writing asset urls", "err", err, "writing_id", wg.ID())
		return map[string]string{}
	}
	return urls
}

func writingErr(err error) error {
	if err == nil {
		return nil
	}
	for _, c := range writingErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fmt.Errorf("writing op: %w", err)
}

var writingErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{corpus.ErrWritingNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("writing not found"), "writing_not_found")
	}},
	{corpus.ErrWritingSlugTaken, func() error {
		return dispatcher.Coded(dispatcher.Conflict("writing slug already taken"), "slug_taken")
	}},
}

// 编译期确认:适配器满足收口声明的那个窄口。
var _ dispatcher.WritingStore = writingOps{}
