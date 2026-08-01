// res_custom_pages_ops.go —— custom_pages 资源的解参 / 调用 / 序列化(声明在 res_custom_pages.go)。

package dispatcher

import (
	"context"
	"encoding/json"
)

type customPageSlugArgs struct {
	Slug    string `json:"slug"`
	Title   string `json:"title"`
	Path    string `json:"path"`
	Content string `json:"content"`
	BuildID string `json:"build_id"`
}

func decodeCustomPageArgs(raw json.RawMessage) (customPageSlugArgs, error) {
	var in customPageSlugArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func customPageList(store CustomPageStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, opErr("list custom pages", err)
		}
		if rows == nil {
			rows = []CustomPage{}
		}
		return marshalOut(rows)
	}
}

func customPageCreate(store CustomPageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCustomPageCreate(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := store.Create(ctx, ownerID, in.Slug, in.Title)
		if err != nil {
			return nil, opErr("create custom page", err)
		}
		return marshalOut(page)
	}
}

func decodeCustomPageCreate(raw json.RawMessage) (customPageSlugArgs, error) {
	in, perr := decodeCustomPageArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, requireArgs([2]string{"slug", in.Slug})
}

func customPageWriteFile(store CustomPageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCustomPageFile(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := store.WriteFile(ctx, ownerID, in.Slug, in.Path, in.Content)
		if err != nil {
			return nil, opErr("write custom page file", err)
		}
		return marshalOut(build)
	}
}

func decodeCustomPageFile(raw json.RawMessage) (customPageSlugArgs, error) {
	in, perr := decodeCustomPageArgs(raw)
	if perr != nil {
		return in, perr
	}
	err := requireArgs(
		[2]string{"slug", in.Slug}, [2]string{"path", in.Path}, [2]string{"content", in.Content},
	)
	return in, err
}

func customPageBuild(store CustomPageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		slug, perr := parseCustomPageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := store.Build(ctx, ownerID, slug)
		if err != nil {
			return nil, opErr("build custom page", err)
		}
		return marshalOut(build)
	}
}

func customPageGetBuild(store CustomPageStore) Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCustomPageBuildID(raw)
		if perr != nil {
			return nil, perr
		}
		build, err := store.GetBuild(ctx, in.BuildID)
		if err != nil {
			return nil, opErr("read build", err)
		}
		return marshalOut(build)
	}
}

func decodeCustomPageBuildID(raw json.RawMessage) (customPageSlugArgs, error) {
	in, perr := decodeCustomPageArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, requireArgs([2]string{"build_id", in.BuildID})
}

// customPagePromote —— staging 和 live 只差调哪个函数;解参和回包形状同一份。
func customPagePromote(
	apply func(ctx context.Context, ownerID, slug, buildID string) (CustomPage, error),
	what string,
) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCustomPagePromote(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := apply(ctx, ownerID, in.Slug, in.BuildID)
		if err != nil {
			return nil, opErr(what, err)
		}
		return marshalOut(page)
	}
}

func decodeCustomPagePromote(raw json.RawMessage) (customPageSlugArgs, error) {
	in, perr := decodeCustomPageArgs(raw)
	if perr != nil {
		return in, perr
	}
	err := requireArgs([2]string{"slug", in.Slug}, [2]string{"build_id", in.BuildID})
	return in, err
}

func customPageRollback(store CustomPageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		slug, perr := parseCustomPageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := store.Rollback(ctx, ownerID, slug)
		if err != nil {
			return nil, opErr("roll back custom page", err)
		}
		return marshalOut(page)
	}
}

// deletedPage —— 删除的回执:删掉了哪一个。
type deletedPage struct {
	Slug    string `json:"slug"`
	Deleted bool   `json:"deleted"`
}

func customPageDelete(store CustomPageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		slug, perr := parseCustomPageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.Delete(ctx, ownerID, slug); err != nil {
			return nil, opErr("delete custom page", err)
		}
		return marshalOut(deletedPage{Slug: slug, Deleted: true})
	}
}

func parseCustomPageSlug(raw json.RawMessage) (string, error) {
	in, perr := decodeCustomPageArgs(raw)
	if perr != nil {
		return "", perr
	}
	if err := requireArgs([2]string{"slug", in.Slug}); err != nil {
		return "", err
	}
	return in.Slug, nil
}
