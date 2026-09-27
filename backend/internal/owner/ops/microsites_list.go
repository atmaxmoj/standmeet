// microsites_list.go —— microsite.list: the paged list plus the two per-row build facets and the
// signed preview address. Split out of microsites.go, which keeps the op table and shapes.

package ops

import (
	"context"
	"encoding/json"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func listMicrosites(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := paging.ParseArgs[repo.MicrositeFilter](raw)
		if perr != nil {
			return nil, fp.BadInput("invalid arguments: " + perr.Error())
		}
		page, err := usecase.ListPages(ctx, deps, ownerID, in.Filter, in.Req)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(paging.Each(page, func(m *entity.Microsite) micrositeOut {
			v := toMicrositeOut(m)
			attachLatestBuild(ctx, deps, &v)
			attachPreviewURL(&v, ownerID, deps.PreviewSigningKey)
			return v
		}))
	}
}

var micrositeListFilters = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string","description":"Only this page (exact slug)."},
		"scope":{"type":"string","enum":["","pages"],
			"description":"pages = every page but the homepage (slug home)."},
		"q":{"type":"string","description":"Case-insensitive substring of the slug or title."}
	}
}`)

// attachLatestBuild —— fills in the two build facets the panel needs. Leave either blank if it
// can't be fetched: **the list must not fail because of this one field**, or the owner can't even
// see what pages they have. Missing a refresh hint beats the whole page failing to load.
//
// The two facets are deliberately different builds:
//   - LatestBuildStatus is the most recent build of ANY status, so the panel can say "building…"
//     while the agent's build is still in flight.
//   - LatestBuildID is the most recent SUCCESSFUL build — the one the preview route actually
//     serves (ResolvePreviewBuild → GetLatestBuiltForPage). The frontend pins the iframe to this
//     id and swaps the frame when it changes. Pinning it to the latest ANY-status build instead
//     stuck the preview blank: the iframe loaded while a build was still pending (preview has no
//     artifact yet → blank), and when that same build later succeeded the id didn't change, so the
//     frame was never swapped to the now-built content.
func attachLatestBuild(ctx context.Context, deps usecase.MicrositeDeps, v *micrositeOut) {
	if latest, err := deps.Builds.GetLatestForPage(ctx, v.ID); err == nil {
		v.LatestBuildStatus = latest.Status
	}
	if built, err := deps.Builds.GetLatestBuiltForPage(ctx, v.ID); err == nil {
		v.LatestBuildID = built.ID
	}
}

// attachPreviewURL —— signs a 10-minute preview address. No key → don't give one (the
// preview won't open then, but the list itself still works — missing a preview beats the
// whole page failing to load).
func attachPreviewURL(v *micrositeOut, ownerID, key string) {
	if key == "" || v.LatestBuildID == "" {
		return
	}
	token := usecase.NewPreviewToken(key, ownerID, v.Slug, time.Now())
	v.PreviewURL = "/api/v1/microsites/" + v.Slug + "/preview/" + token
}
