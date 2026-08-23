// custom_pages_authoring.go —— 写一个自定义页的那几步:建 → 写文件 → 构建 → 上 staging
// → 上线 / 回滚 / 删。构建器是异步的,所以构建那步回一个 build_id 让调用方轮询。

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func customPageAuthoringOps(deps usecase.CustomPageDeps) []fp.Op {
	return append(customPageSettingOps(deps), customPageBuildOps(deps)...)
}

// customPageSettingOps —— 页面自己的设置（不涉及构建）。
func customPageSettingOps(deps usecase.CustomPageDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "custom_page.set_byoai",
			Description: "Allow or forbid readers bringing their own key on this page. " +
				"This applies only when nobody presents a grant — a reader arriving with " +
				"an access code is scoped by that code, and this setting is then inert.",
			InputSchema: pageByoaiSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCustomPageByoai(deps),
		},
	}
}

func customPageBuildOps(deps usecase.CustomPageDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "custom_page.create",
			// F-L-44：这里曾写 `/<handle>/p/<slug>` —— 那个地址 404，真地址是 `/p/<slug>`
			// （实例是单 owner，URL 不带 handle）。**owner 的 AI 只读 description**，
			// 所以一个说错的地址就是它转告给 owner 的地址。
			Description: "Create a custom page, served at /p/<slug>.",
			InputSchema: pageCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createCustomPage(deps),
		},
		{
			ID:          "custom_page.write_file",
			Description: "Add or overwrite one source file in the page's draft.",
			InputSchema: pageFileSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeCustomPageFile(deps),
		},
		{
			ID: "custom_page.build",
			Description: "Build the current draft. The builder is asynchronous — poll the " +
				"returned build id with custom_page.get_build.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      buildCustomPage(deps),
		},
		{
			ID:          "custom_page.promote_to_staging",
			Description: "Put a finished build on staging, where only the owner can see it.",
			InputSchema: pagePromoteSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promoteCustomPage(deps, usecase.PromoteToStaging, "promote to staging"),
		},
		{
			ID:          "custom_page.promote_to_live",
			Description: "Put a finished build live, where visitors see it.",
			InputSchema: pagePromoteSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promoteCustomPage(deps, usecase.PromoteToLive, "promote to live"),
		},
		{
			ID:          "custom_page.rollback",
			Description: "Send live back to the previous build. No-op if there is none.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rollbackCustomPage(deps),
		},
		{
			ID:          "custom_page.delete",
			Description: "Delete a custom page.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteCustomPage(deps),
		},
	}
}

// createCustomPage —— 不给标题就用 slug 当标题(建页时通常只想到地址)。
func createCustomPage(deps usecase.CustomPageDeps) fp.Invoke {
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
			return nil, customPageErr(err)
		}
		return json.Marshal(toCustomPageOut(&page))
	}
}

func writeCustomPageFile(deps usecase.CustomPageDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageFile(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := usecase.WriteFile(ctx, deps, &usecase.WriteFileInput{
			OwnerID: ownerID, Slug: in.Slug, Path: in.Path, Content: in.Content,
		})
		if err != nil {
			return nil, customPageErr(err)
		}
		return json.Marshal(toBuildOut(&build))
	}
}

func buildCustomPage(deps usecase.CustomPageDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := usecase.Build(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, customPageErr(err)
		}
		return json.Marshal(toBuildOut(&build))
	}
}

// promoteFn —— staging / live 两个方向在域里是两个函数;这一层只选其一。
type promoteFn func(
	ctx context.Context, deps usecase.CustomPageDeps, ownerID, slug, buildID string,
) (entity.CustomPage, error)

func promoteCustomPage(deps usecase.CustomPageDeps, apply promoteFn, what string) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePagePromote(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := apply(ctx, deps, ownerID, in.Slug, in.BuildID)
		if err != nil {
			return nil, fp.OpErr(what, customPageErr(err))
		}
		return json.Marshal(toCustomPageOut(&page))
	}
}

func rollbackCustomPage(deps usecase.CustomPageDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := usecase.Rollback(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, customPageErr(err)
		}
		return json.Marshal(toCustomPageOut(&page))
	}
}

func deleteCustomPage(deps usecase.CustomPageDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeletePage(ctx, deps, ownerID, in.Slug); err != nil {
			return nil, customPageErr(err)
		}
		return json.Marshal(deletedPageOut{Slug: in.Slug, Deleted: true})
	}
}

// setCustomPageByoai —— 这一页在无人出示 grant 时给不给用自己的 key。
func setCustomPageByoai(deps usecase.CustomPageDeps) fp.Invoke {
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
			return nil, customPageErr(err)
		}
		out := toCustomPageOut(&page)
		return json.Marshal(out)
	}
}

// deletedPageOut —— 删除的回执:删掉了哪一个。
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
