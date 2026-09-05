// microsites_authoring.go —— the steps to author a microsite: create → write file →
// build → promote to staging → go live / roll back / delete. The builder is asynchronous,
// so the build step returns a build_id for the caller to poll.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func micrositeAuthoringOps(deps usecase.MicrositeDeps) []fp.Op {
	ops := append(micrositeSettingOps(deps), micrositeBuildOps(deps)...)
	return append(ops, micrositeGuideOps()...)
}

// micrositeSettingOps —— the page's own settings (nothing build-related).
func micrositeSettingOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "microsite.set_byoai",
			Description: "Allow or forbid readers bringing their own key on this page. " +
				"This applies only when nobody presents a grant — a reader arriving with " +
				"an access code is scoped by that code, and this setting is then inert.",
			InputSchema: pageByoaiSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setMicrositeByoai(deps),
		},
		{
			ID: "microsite.set_store_writable",
			Description: "Open or close this page's data store to visitor writes. Off by " +
				"default: a page has no write surface until you open it. Reads are unaffected.",
			InputSchema: micrositeStoreWritableSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setMicrositeStoreWritable(deps),
		},
	}
}

// setMicrositeStoreWritable —— toggle whether visitors may write this page's data store (model C).
func setMicrositeStoreWritable(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if in.StoreWritable == nil {
			return nil, fp.BadInput("store_writable is required")
		}
		err := usecase.OwnerSetWritable(ctx, deps, ownerID, in.Slug, *in.StoreWritable)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(storeWritableOut{Slug: in.Slug, StoreWritable: *in.StoreWritable})
	}
}

// storeWritableOut —— the toggle receipt.
type storeWritableOut struct {
	Slug          string `json:"slug"`
	StoreWritable bool   `json:"store_writable"`
}

func micrositeBuildOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "microsite.create",
			// F-L-44: this used to say `/<handle>/p/<slug>` — that address 404s, the
			// real address is `/p/<slug>` (the instance is single-owner, the URL
			// carries no handle). **The owner's AI only reads the description**, so a
			// wrong address here is the address it relays to the owner.
			Description: "Create a microsite, served at /p/<slug>.",
			InputSchema: pageCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createMicrosite(deps),
		},
		{
			ID: "microsite.write_file",
			Description: "Add or overwrite one source file in the page's draft. Call " +
				"microsite.guide first: it gives the design system, the SDK widgets to import, " +
				"and how to show corpus inline instead of linking away.",
			InputSchema: pageFileSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeMicrositeFile(deps),
		},
		{
			ID:          "microsite.get_draft",
			Description: "The page's current draft source files (path → content), for editing.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getMicrositeDraft(deps),
		},
		{
			ID: "microsite.build",
			Description: "Build the current draft. The builder is asynchronous — poll the " +
				"returned build id with microsite.get_build.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      buildMicrosite(deps),
		},
		{
			ID:          "microsite.promote_to_staging",
			Description: "Put a finished build on staging, where only the owner can see it.",
			InputSchema: pagePromoteSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promoteMicrosite(deps, usecase.PromoteToStaging, "promote to staging"),
		},
		{
			ID:          "microsite.promote_to_live",
			Description: "Put a finished build live, where visitors see it.",
			InputSchema: pagePromoteSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promoteMicrosite(deps, usecase.PromoteToLive, "promote to live"),
		},
		{
			ID:          "microsite.rollback",
			Description: "Send live back to the previous build. No-op if there is none.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rollbackMicrosite(deps),
		},
		{
			ID:          "microsite.delete",
			Description: "Delete a microsite.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteMicrosite(deps),
		},
	}
}

// createMicrosite —— no title given → use the slug as the title (creating a page usually
// means only the address was on the caller's mind).
func createMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		title := in.Title
		if title == "" {
			title = in.Slug
		}
		page, err := usecase.CreatePage(ctx, deps, &usecase.CreatePageInput{
			OwnerID: ownerID, Slug: in.Slug, Title: title,
		})
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toMicrositeOut(&page))
	}
}

func writeMicrositeFile(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageFile(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := usecase.WriteFile(ctx, deps, &usecase.WriteFileInput{
			OwnerID: ownerID, Slug: in.Slug, Path: in.Path, Content: in.Content,
		})
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toBuildOut(&build))
	}
}

// draftFilesOut — the editor's load payload: the slug and its draft files (path → content).
type draftFilesOut struct {
	Files map[string]string `json:"files"`
	Slug  string            `json:"slug"`
}

func getMicrositeDraft(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		files, err := usecase.GetDraftFiles(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(draftFilesOut{Slug: in.Slug, Files: files})
	}
}

func buildMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := usecase.Build(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toBuildOut(&build))
	}
}

// promoteFn —— staging / live are two separate functions in the domain; this layer just
// picks one.
type promoteFn func(
	ctx context.Context, deps usecase.MicrositeDeps, ownerID, slug, buildID string,
) (entity.Microsite, error)

func promoteMicrosite(deps usecase.MicrositeDeps, apply promoteFn, what string) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePagePromote(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := apply(ctx, deps, ownerID, in.Slug, in.BuildID)
		if err != nil {
			return nil, fp.OpErr(what, micrositeErr(err))
		}
		return json.Marshal(toMicrositeOut(&page))
	}
}

func rollbackMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := usecase.Rollback(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toMicrositeOut(&page))
	}
}

func deleteMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeletePage(ctx, deps, ownerID, in.Slug); err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(deletedPageOut{Slug: in.Slug, Deleted: true})
	}
}

// setMicrositeByoai —— whether this page allows a reader's own key when no grant is
// presented.
func setMicrositeByoai(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if in.AllowByoai == nil {
			return nil, fp.BadInput("allow_byoai is required")
		}
		page, err := usecase.SetPageByoai(ctx, deps, ownerID, in.Slug, *in.AllowByoai)
		if err != nil {
			return nil, micrositeErr(err)
		}
		out := toMicrositeOut(&page)
		return json.Marshal(out)
	}
}

// deletedPageOut —— the delete receipt: which one got deleted.
type deletedPageOut struct {
	Slug    string `json:"slug"`
	Deleted bool   `json:"deleted"`
}

func decodePageSlug(raw json.RawMessage) (pageArgs, error) {
	in, perr := decodePageArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"slug", in.Slug})
}

func decodePageFile(raw json.RawMessage) (pageArgs, error) {
	in, perr := decodePageArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs(
		[2]string{"slug", in.Slug}, [2]string{"path", in.Path},
		[2]string{"content", in.Content},
	)
}

func decodePagePromote(raw json.RawMessage) (pageArgs, error) {
	in, perr := decodePageArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"slug", in.Slug}, [2]string{"build_id", in.BuildID})
}
