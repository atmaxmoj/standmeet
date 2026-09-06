// microsites_rename_seo.go — the rename + per-page SEO authoring invokes. Split out of
// microsites_authoring.go to keep that file under the max-lines cap.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// renameMicrosite —— change a page's slug. Returns the updated page (with its new slug).
func renameMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageRename(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := usecase.RenamePage(ctx, deps, ownerID, in.Slug, in.NewSlug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toMicrositeOut(&page))
	}
}

func decodePageRename(raw json.RawMessage) (pageArgs, error) {
	in, perr := decodePageArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"slug", in.Slug}, [2]string{"new_slug", in.NewSlug})
}

// setMicrositeSEO —— set this page's per-page SEO (title + description).
func setMicrositeSEO(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		serr := usecase.SetPageSEO(ctx, deps, &usecase.SetPageSEOInput{
			OwnerID: ownerID, Slug: in.Slug,
			Title: in.SeoTitle, Description: in.SeoDescription, Image: in.SeoImage,
		})
		if serr != nil {
			return nil, micrositeErr(serr)
		}
		return json.Marshal(pageSeoOut{
			Slug: in.Slug, SeoTitle: in.SeoTitle,
			SeoDescription: in.SeoDescription, SeoImage: in.SeoImage,
		})
	}
}

// pageSeoOut —— the set_seo receipt.
type pageSeoOut struct {
	Slug           string `json:"slug"`
	SeoTitle       string `json:"seo_title"`
	SeoDescription string `json:"seo_description"`
	SeoImage       string `json:"seo_image"`
}
