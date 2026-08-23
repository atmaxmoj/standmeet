// codes_page_binding.go —— 一张码开哪一页。
//
// 从 codes.go 拆出来（那个文件到了 350 行的闸）。拆的边界不是"行数不够了随便切一刀"：
// 绑定是这张表上一个自成一体的关注点 —— **页面是这张码的一个渲染**，授权、配额、身份、
// 记账全不变，只换读者看到的样子。它跟发码/撤码/配额不是一件事。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// codeOwnerIDs —— 一对已解析的 uuid。用 struct 而非多值返回，让 revive 的
// function-result-limit 不抱怨（跟 buildRefIDs 同一手法）。
type codeOwnerIDs struct {
	owner pgtype.UUID
	code  pgtype.UUID
}

func parseCodeAndOwner(ownerID, codeID string) (codeOwnerIDs, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return codeOwnerIDs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return codeOwnerIDs{}, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	return codeOwnerIDs{owner: ownerUUID, code: codeUUID}, nil
}

// setCodePageSQL —— slug → page id 在**一条 SQL 里**解（子查询带 owner_id），
// 而不是先查一次再写：分两步的话，中间那一瞬页被删掉，写下去的就是一个悬空 id。
// RETURNING 回读**绑完之后**的 slug —— 入参回声只能证明"我收到了"，回读才证明"现在就是这样"。
const setCodePageSQL = `
	UPDATE access_codes SET custom_page_id = CASE WHEN $3 = '' THEN NULL ELSE (
		SELECT id FROM custom_pages
		WHERE owner_id = $2 AND slug = $3 AND status != 'deleted'
	) END
	WHERE id = $1 AND owner_id = $2
	RETURNING COALESCE((
		SELECT cp.slug::text FROM custom_pages cp WHERE cp.id = access_codes.custom_page_id
	), '')`

// SetCustomPage —— 这张码开哪一页。slug 空串 = 解绑，退回默认的访客对话。
//
// 无行 = 这张码不是这个 owner 的 → ErrCodeInvalid，不静默成功。
func (r *CodeRepo) SetCustomPage(
	ctx context.Context, ownerID, codeID, slug string,
) (entity.Code, error) {
	ids, perr := parseCodeAndOwner(ownerID, codeID)
	if perr != nil {
		return entity.Code{}, perr
	}
	var boundSlug string
	err := r.pool.QueryRow(ctx, setCodePageSQL, ids.code, ids.owner, slug).Scan(&boundSlug)
	if err != nil {
		return entity.Code{}, setCodePageErr(err)
	}
	// **要绑却绑成了空** = 那个 slug 这个 owner 没有。静默留成"没绑"是最坏的结果：
	// owner 以为连上了，读者却落在默认对话上。
	if slug != "" && boundSlug == "" {
		return entity.Code{}, entity.ErrCodeInvalid
	}
	return entity.Code{ID: codeID, CustomPageSlug: boundSlug}, nil
}

func setCodePageErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrCodeInvalid
	}
	return fmt.Errorf("set code custom page: %w", err)
}
