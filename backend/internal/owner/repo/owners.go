// Repo wrap sqlc 生成的 db.Queries。
// 把 pgtype.* 映射到 Owner 纯 Go 类型，让 usecase / routes 层
// 不用知道 pgtype。

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// pgxErrNoRows —— helper：避免直接在多处 import pgx.ErrNoRows，让 grep 起点一致。
func pgxErrNoRows() error { return pgx.ErrNoRows }

// parseOwnerIDErrFmt —— "parse owner id" 字面在本文件多次出现，提取常量。
const parseOwnerIDErrFmt = "parse owner id: %w"

// Repo 提供 owner CRUD（当前只用 Create 和 Count；后续扩展）。
type Repo struct {
	pool *pgstore.Pool
}

// NewRepo 构造 Repo。
func NewRepo(pool *pgstore.Pool) *Repo {
	return &Repo{pool: pool}
}

// Count 返回 owners 表行数（用于"是否有 owner"的判定）。
func (r *Repo) Count(ctx context.Context) (int64, error) {
	q := db.New(r.pool)
	n, err := q.CountOwners(ctx)
	if err != nil {
		return 0, fmt.Errorf("count owners: %w", err)
	}
	return n, nil
}

// FirstHandle 返最早 owner 的 handle；表为空返 ""（不报错，app 根路径
// 据此判断是否引导用户去 /setup）。
func (r *Repo) FirstHandle(ctx context.Context) (string, error) {
	q := db.New(r.pool)
	handle, err := q.GetFirstOwnerHandle(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return "", nil
		}
		return "", fmt.Errorf("get first owner handle: %w", err)
	}
	return handle, nil
}

// pgUniqueViolation 检测 pgx unique constraint 冲突，返回 constraint 名 +
// 是否命中。让 caller 把 DB-level 错误翻译成 domain sentinel error。
// toDomainOwner 把 sqlc 生成的 db.Owner（带 pgtype.UUID / Timestamptz）
// 映射到 Owner（纯 Go 类型，identity only）。
// settings 字段通过 toOwnerSettings 单独解（同一行 owners 表 row 拆两面）。
func toDomainOwner(o *db.Owner) entity.Owner {
	return entity.Owner{
		ID:              pgstore.FormatUUID(o.ID),
		Email:           o.Email,
		Handle:          o.Handle,
		FullName:        o.FullName,
		Location:        o.Location,
		PublicURL:       o.PublicUrl,
		ProfileTimezone: o.ProfileTimezone,
		PendingEmail:    derefString(o.PendingEmail),
		CreatedAt:       o.CreatedAt.Time,
	}
}

// derefString —— nullable 列取值。空指针出空串:调用方要区分的是"有没有待确认",
// 而不是 NULL 和 ” 的区别(那个区别在这一列上没有含义)。
func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// toOwnerSettings —— owners 行的 byoai_* + **默认那条 provider** 拼成 Settings。
//
// AI 那一面以前直接读 owners 行上的四列;provider 变成一本之后,"owner 的 AI 设置"
// 说的就是**默认那一条**(其余是本子里的别的条目,由 providers.* 那组操作管)。
// def 为 nil = 这个 owner 还没有任何 provider(claim 之前),AI 那一面出零值。
// 明文 key 不出 repo,外层只看 KeyConfigured。
func toOwnerSettings(o *db.Owner, def *ProviderRow) entity.Settings {
	out := entity.Settings{
		BYOAI: entity.BYOAISettings{
			Enabled:     o.ByoaiEnabled,
			Providers:   decodeProviders(o.ByoaiProviders),
			PublicBlurb: o.ByoaiPublicBlurb,
		},
	}
	if def != nil {
		out.AI = entity.AISettings{
			Provider: def.Provider, Endpoint: def.Endpoint,
			Model: def.Model, KeyConfigured: def.KeyConfigured,
		}
	}
	return out
}

// decodeProviders 把 byoai_providers jsonb 解到 []string。空 / 解失败返空 slice；
// usecase 视空为 "default providers"，handler 编码时按 [] 输出。
func decodeProviders(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return out
}

// UpdateBYOAIInput —— Update 入参。字段顺序按 govet fieldalignment：
// strings 先（ptr at 0），slice 紧跟（ptr at 0 也连续），bool 末尾。
type UpdateBYOAIInput struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// UpdateBYOAI 更新 owner 行的 byoai_enabled / providers / blurb；返回新
// OwnerSettings（不是整个 Owner，settings 是聚合的独立切面）。
func (r *Repo) UpdateBYOAI(
	ctx context.Context, in *UpdateBYOAIInput,
) (entity.Settings, error) {
	params, perr := buildBYOAIParams(in)
	if perr != nil {
		return entity.Settings{}, perr
	}
	q := db.New(r.pool)
	row, uerr := q.UpdateOwnerBYOAI(ctx, params)
	if uerr != nil {
		if errors.Is(uerr, pgxErrNoRows()) {
			return entity.Settings{}, entity.ErrOwnerNotFound
		}
		return entity.Settings{}, fmt.Errorf("update byoai: %w", uerr)
	}
	return r.settingsFor(ctx, &row), nil
}

// GetSettings —— 拉 owner 行的 settings 切面（不含 identity）。
// /me 端要 owner + settings 拼起来时调它，跟 GetByID 各自只取自己那半。
func (r *Repo) GetSettings(
	ctx context.Context, ownerID string,
) (entity.Settings, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Settings{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return entity.Settings{}, entity.ErrOwnerNotFound
		}
		return entity.Settings{}, fmt.Errorf("get owner settings: %w", err)
	}
	return r.settingsFor(ctx, &row), nil
}

// buildBYOAIParams 把入参 normalize + marshal 一气呵成，让 UpdateBYOAI
// 自己 cyclo ≤ 5。
func buildBYOAIParams(in *UpdateBYOAIInput) (db.UpdateOwnerBYOAIParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.UpdateOwnerBYOAIParams{}, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	providers := in.Providers
	if providers == nil {
		providers = []string{}
	}
	encoded, merr := json.Marshal(providers)
	if merr != nil {
		return db.UpdateOwnerBYOAIParams{}, fmt.Errorf("marshal providers: %w", merr)
	}
	return db.UpdateOwnerBYOAIParams{
		ID:               ownerUUID,
		ByoaiEnabled:     in.Enabled,
		ByoaiProviders:   encoded,
		ByoaiPublicBlurb: in.Blurb,
	}, nil
}

// UpdatePublicURL —— owner 改部署的 canonical public URL（claim 后改域名时调）。
// 没有 alias 表（public_url 不参与 routing；只用作 QR / SEO canonical），
// 单条 UPDATE 即可。
func (r *Repo) UpdatePublicURL(
	ctx context.Context, ownerID, normalized string,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateOwnerPublicURL(ctx, db.UpdateOwnerPublicURLParams{
		ID: pgID, PublicUrl: normalized,
	})
	if qerr != nil {
		return entity.Owner{}, fmt.Errorf("update public_url: %w", qerr)
	}
	return toDomainOwner(&row), nil
}

// settingsFor —— 读默认 provider 再拼 Settings。没有默认(还没 claim / 刚删空)不是错:
// AI 那一面出零值,owner 面板据此显示"还没配"。
func (r *Repo) settingsFor(ctx context.Context, o *db.Owner) entity.Settings {
	def, err := r.DefaultProvider(ctx, pgstore.FormatUUID(o.ID))
	if err != nil {
		return toOwnerSettings(o, nil)
	}
	return toOwnerSettings(o, &def)
}

// provider 那一组(view / 解析链 / 写默认那条 / 封 key)都在 providers.go 和
// provider_view.go —— 这个文件只管 owner 本身:身份、byoai、settings 那一面。
