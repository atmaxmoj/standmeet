// microsites.go —— React pages the owner writes themselves.
//
// The authoring set is **deliberately MCP-only**: a page is authored by writing code, the
// owner writes files, triggers builds, and watches build results from inside an AI client —
// the panel has no such path. This isn't a gap, it's a product decision — writing it into
// each entry's Reach means the ratchet never "helpfully" grows a panel twin for it one day.
//
// The list op exists on both faces; the two used to differ. The panel's copy carried status,
// whether live/staging existed, and timestamps (the owner uses them to judge "did it go
// out"); MCP's copy had only id/slug/title, plus an extra {pages:[...]} wrapper. Now there's
// one shape.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Microsites —— list + authoring (create / write file / build / check build / promote to
// staging / go live / roll back / delete).
func Microsites(deps usecase.MicrositeDeps) []fp.Op {
	return append(micrositeReadOps(deps), micrositeAuthoringOps(deps)...)
}

// ⚠️ There used to be an `authoringOnMCP()` entry here:
//
//	fp.Only("authoring a custom page means writing code and driving the sandbox builder;
//	         the panel has no such surface", "mcp")
//
// **Its reasoning was circular** — "the panel has no such UI" was the very state of affairs
// it was there to explain. And it was written where the ratchet could read it, so this gap
// stopped being reported from then on: an exception that made itself legitimate.
//
// It's deleted, so completeness applies again (the rule on the owner face is "every owner
// op exists on every owner facade"). The ratchet now **requires** these entries to carry
// admin, and keeps requiring it. The MCP path is untouched — this is parity, not a move:
// the owner uses whichever one is convenient — MCP inside Claude, the panel entry here.
// Same family: F-C-47 (a connector passed in with no face to fill its credentials),
// F-C-57 (expose checked with nowhere to grant it).

func micrositeReadOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "microsite.list",
			Description: "List the owner's custom pages with what is live, what is waiting in " +
				"staging, and when each was last touched.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listMicrosites(deps),
		},
		{
			ID:          "microsite.get_build",
			Description: "Poll one build: pending → building → built | failed.",
			InputSchema: buildIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getMicrositeBuild(deps),
		},
	}
}

var (
	buildIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"build_id":{"type":"string"}},
		"required":["build_id"]
	}`)

	pageSlugSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"slug":{"type":"string"}},
		"required":["slug"]
	}`)

	pageCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string","description":"URL slug: a-z0-9-."},
			"title":{"type":"string","description":"Display title; defaults to the slug."}
		},
		"required":["slug"]
	}`)

	pageFileSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"path":{"type":"string","description":"Relative path, e.g. 'App.tsx'."},
			"content":{"type":"string","description":"File body. Max 64 KiB."}
		},
		"required":["slug","path","content"]
	}`)

	pagePromoteSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"build_id":{"type":"string"}
		},
		"required":["slug","build_id"]
	}`)

	pageByoaiSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"allow_byoai":{"type":"boolean",
				"description":
				"Applies only when no grant is presented; a code scopes the reader instead."}
		},
		"required":["slug","allow_byoai"]
	}`)

	micrositeStoreWritableSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"store_writable":{"type":"boolean",
				"description":
				"Whether visitors may write this page's data store. Off by default."}
		},
		"required":["slug","store_writable"]
	}`)
)

// micrositeOut / buildOut —— outbound shape (same for both faces).
type micrositeOut struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	LiveBuildID string `json:"live_build_id,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	// LatestBuildID / LatestBuildStatus —— this page's **most recent build** (whether
	// it succeeded or not).
	//
	// The panel uses LatestBuildID to decide "the preview should refresh": the owner
	// is directing an agent to edit the page, and the agent's every build produces a
	// new id — the only value that changes along with that event (has_staging is a
	// bool that stays put across a new version; live_build_id only moves once
	// promoted). Status rides along so the owner can see "a build is in progress"
	// rather than staring at an unchanged old preview.
	LatestBuildID     string `json:"latest_build_id,omitempty"`
	LatestBuildStatus string `json:"latest_build_status,omitempty"`
	// PreviewURL —— the src of the panel's preview iframe, **with the token already
	// signed into it**.
	//
	// Supplied by the backend, not assembled by the frontend: the token needs signing
	// with the server's key, and a "the frontend assembles the address itself" path
	// will eventually drift from the server's format — and after it drifts, the
	// preview goes blank with nothing reporting an error.
	PreviewURL string `json:"preview_url,omitempty"`

	// BoundCodes —— which live codes unlock this page. The other end of the binding;
	// the code side can see the page, this side can see the codes.
	// **Always send the array, even empty** — absence and "no code points at it" are
	// two different things.
	// Field order follows govet fieldalignment: slice after string, before bool.
	BoundCodes []string `json:"bound_codes"`

	HasLive    bool `json:"has_live"`
	HasStaging bool `json:"has_staging"`
	// AllowBYOAI —— whether to allow a reader's own key when nobody presents a grant.
	// Voided once a code shows up (I-4).
	AllowBYOAI bool `json:"allow_byoai"`
}

type buildOut struct {
	BuildID      string `json:"build_id"`
	PageID       string `json:"page_id"`
	Status       string `json:"status"`
	OutputPath   string `json:"output_path"`
	ErrorMessage string `json:"error_message"`
}

func toMicrositeOut(p *entity.Microsite) micrositeOut {
	codes := p.BoundCodes
	if codes == nil {
		codes = []string{} // Empty array, not null — a reader can't tell null from
		// "there are none" ([[empty-is-not-json-null]]).
	}
	v := micrositeOut{
		ID: p.ID, Slug: p.Slug, Title: p.Title, Status: p.Status,
		BoundCodes: codes, AllowBYOAI: p.AllowBYOAI,
		HasLive: p.LiveBuildID != nil, HasStaging: p.StagingBuildID != nil,
		CreatedAt: p.CreatedAt.Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt.Format(time.RFC3339),
	}
	if p.LiveBuildID != nil {
		v.LiveBuildID = *p.LiveBuildID
	}
	return v
}

func toBuildOut(b *entity.MicrositeBuild) buildOut {
	return buildOut{
		BuildID: b.ID, PageID: b.PageID, Status: b.Status,
		OutputPath: b.OutputPath, ErrorMessage: b.ErrorMessage,
	}
}

func listMicrosites(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListPages(ctx, deps, ownerID)
		if err != nil {
			return nil, micrositeErr(err)
		}
		out := make([]micrositeOut, 0, len(rows))
		for i := range rows {
			v := toMicrositeOut(&rows[i])
			attachLatestBuild(ctx, deps, &v)
			attachPreviewURL(&v, ownerID, deps.PreviewSigningKey)
			out = append(out, v)
		}
		return json.Marshal(out)
	}
}

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

func getMicrositeBuild(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"build_id", in.BuildID}); err != nil {
			return nil, err
		}
		build, err := usecase.GetBuild(ctx, deps, in.BuildID)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toBuildOut(&build))
	}
}

// pageArgs —— the shared arg bag for this group (each op reads only the fields it needs).
type pageArgs struct {
	// AllowByoai —— set_byoai's argument. **A pointer**: distinguishes "field not
	// given" from "explicitly given as false"; a bare bool would read both as off
	// (same family as the [[lesson-not-swept-to-neighbours]] lesson).
	// Ordered first per fieldalignment (pointers before others).
	AllowByoai *bool `json:"allow_byoai"`
	// StoreWritable —— set_store_writable's argument. A pointer for the same reason as AllowByoai.
	StoreWritable *bool  `json:"store_writable"`
	Slug          string `json:"slug"`
	Title         string `json:"title"`
	Path          string `json:"path"`
	Content       string `json:"content"`
	BuildID       string `json:"build_id"`
}

func decodePageArgs(raw json.RawMessage) (pageArgs, error) {
	var in pageArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func micrositeErr(err error) error {
	for _, c := range micrositeErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("custom page op", err)
}

var micrositeErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrMicrositeNotFound, func() error {
		return fp.Coded(fp.NotFound("page not found"), "page_not_found")
	}},
	{entity.ErrMicrositeBuildNotFound, func() error {
		return fp.Coded(fp.NotFound("build not found"), "build_not_found")
	}},
	{entity.ErrMicrositeSlugTaken, func() error {
		return fp.Coded(fp.Conflict("slug already taken"), "slug_taken")
	}},
}
