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
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
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
		CreatedAt:       o.CreatedAt.Time,
	}
}

// toOwnerSettings —— 把 owners 行的 setting 字段（byoai_* + ai_*）拼成
// Settings 值对象。明文 key 不出 repo，外层只看 KeyConfigured。
func toOwnerSettings(o *db.Owner) entity.Settings {
	return entity.Settings{
		AI: entity.AISettings{
			Provider:      o.AiProvider,
			Endpoint:      o.AiEndpoint,
			Model:         o.AiModel,
			KeyConfigured: len(o.AiProviderKeyEnc) > 0,
		},
		BYOAI: entity.BYOAISettings{
			Enabled:     o.ByoaiEnabled,
			Providers:   decodeProviders(o.ByoaiProviders),
			PublicBlurb: o.ByoaiPublicBlurb,
		},
	}
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
	return toOwnerSettings(&row), nil
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
	return toOwnerSettings(&row), nil
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

// UpdateAIProviderInput —— admin "AI provider" 表单的 commit 入参。
// KeyPlaintext == nil 表示不动 key（只改 provider / endpoint / model）；
// 空 string 显式清掉 key。Endpoint 仅 provider='custom' 必填；Model 留空
// 时 inference resolver 走 preset 默认。
type UpdateAIProviderInput struct {
	KeyPlaintext *string
	OwnerID      string
	Provider     string
	Endpoint     string
	Model        string
}

// AIProviderView —— inference resolver 需要的最小信息。KeyEnc 是密文,**本域不开封**:
// owner 域只封(写路径 cryptobox.Encrypt)不解,开封在组装那一侧
// (cmd/server 的 openAIProviderKey)。Endpoint + Model 仅 custom 或 owner 显式覆盖
// preset 默认时非空。
type AIProviderView struct {
	Provider string
	Endpoint string
	Model    string
	KeyEnc   []byte
}

// GetAIProviderView —— 拉 owner 的 AI provider 配置（不返其它字段）。
// resolver 不该 import postgres，所以这个方法返一个独立的 view 类型；
// cmd/server 用 adapter 把它包成 inference.OwnerKeyView。
func (r *Repo) GetAIProviderView(
	ctx context.Context, ownerID string,
) (AIProviderView, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return AIProviderView{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AIProviderView{}, entity.ErrOwnerNotFound
		}
		return AIProviderView{}, fmt.Errorf("get owner for provider view: %w", err)
	}
	return AIProviderView{
		Provider: row.AiProvider, Endpoint: row.AiEndpoint, Model: row.AiModel,
		KeyEnc: row.AiProviderKeyEnc,
	}, nil
}

// UpdateAIProvider —— commit owner 的 AI provider 选择。当 KeyPlaintext 非
// nil 时同步换 ai_provider_key_enc；为 nil 时保留原 key（仅切 provider）。
// 返回新 OwnerSettings（聚合的独立切面）。
func (r *Repo) UpdateAIProvider(
	ctx context.Context, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	pgID, perr := pgstore.ParseUUID(in.OwnerID)
	if perr != nil {
		return entity.Settings{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	encBytes, eerr := r.resolveKeyBytes(ctx, pgID, in.KeyPlaintext)
	if eerr != nil {
		return entity.Settings{}, eerr
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateOwnerAIProvider(ctx, db.UpdateOwnerAIProviderParams{
		ID: pgID, AiProvider: in.Provider, AiProviderKeyEnc: encBytes,
		AiEndpoint: in.Endpoint, AiModel: in.Model,
	})
	if qerr != nil {
		return entity.Settings{}, fmt.Errorf("update ai provider: %w", qerr)
	}
	return toOwnerSettings(&row), nil
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

// resolveKeyBytes —— KeyPlaintext nil 时复用原 enc bytes；非 nil 时空字符串
// 清空（[]byte{}），非空字符串用 cryptobox 加密。给 UpdateAIProvider 用。
func (r *Repo) resolveKeyBytes(
	ctx context.Context, pgID pgtype.UUID, key *string,
) ([]byte, error) {
	if key == nil {
		row, err := db.New(r.pool).GetOwnerByID(ctx, pgID)
		if err != nil {
			return nil, fmt.Errorf("get owner for key carryover: %w", err)
		}
		return row.AiProviderKeyEnc, nil
	}
	if *key == "" {
		return []byte{}, nil
	}
	// AAD = owner_id: 绑定 LLM key 密文到该 owner；resolver 用同一 owner_id 串解(matched)。
	encBytes, err := cryptobox.Encrypt([]byte(*key), []byte(pgstore.FormatUUID(pgID)))
	if err != nil {
		return nil, fmt.Errorf("encrypt ai key: %w", err)
	}
	return encBytes, nil
}
