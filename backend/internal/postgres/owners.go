// OwnerRepo wrap sqlc 生成的 dbq.Queries。
// 把 pgtype.* 映射到 domain.Owner 纯 Go 类型，让 usecase / routes 层
// 不用知道 pgtype。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/cryptobox"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// pgxErrNoRows —— helper：避免直接在多处 import pgx.ErrNoRows，让 grep 起点一致。
func pgxErrNoRows() error { return pgx.ErrNoRows }

// pgUniqueViolationSQLState 是 unique constraint 冲突的 SQLSTATE，让
// pgUniqueViolation 翻译 DB 错误到 domain sentinel 时 hardcode 不出现。
const pgUniqueViolationSQLState = "23505"

// OwnerRepo 提供 owner CRUD（当前只用 Create 和 Count；后续扩展）。
type OwnerRepo struct {
	pool *Pool
}

// NewOwnerRepo 构造 OwnerRepo。
func NewOwnerRepo(pool *Pool) *OwnerRepo {
	return &OwnerRepo{pool: pool}
}

// Count 返回 owners 表行数（用于"是否有 owner"的判定）。
func (r *OwnerRepo) Count(ctx context.Context) (int64, error) {
	q := dbq.New(r.pool)
	n, err := q.CountOwners(ctx)
	if err != nil {
		return 0, fmt.Errorf("count owners: %w", err)
	}
	return n, nil
}

// FirstHandle 返最早 owner 的 handle；表为空返 ""（不报错，app 根路径
// 据此判断是否引导用户去 /setup）。
func (r *OwnerRepo) FirstHandle(ctx context.Context) (string, error) {
	q := dbq.New(r.pool)
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
func pgUniqueViolation(err error) (string, bool) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationSQLState {
		return pgErr.ConstraintName, true
	}
	return "", false
}

// toDomainOwner 把 sqlc 生成的 dbq.Owner（带 pgtype.UUID / Timestamptz）
// 映射到 domain.Owner（纯 Go 类型，identity only）。
// settings 字段通过 toOwnerSettings 单独解（同一行 owners 表 row 拆两面）。
func toDomainOwner(o *dbq.Owner) domain.Owner {
	return domain.Owner{
		ID:        formatUUID(o.ID),
		Email:     o.Email,
		Handle:    o.Handle,
		FullName:  o.FullName,
		Location:  o.Location,
		PublicURL: o.PublicUrl,
		CreatedAt: o.CreatedAt.Time,
	}
}

// toOwnerSettings —— 把 owners 行的 setting 字段（byoai_* + ai_*）拼成
// domain.OwnerSettings 值对象。明文 key 不出 repo，外层只看 KeyConfigured。
func toOwnerSettings(o *dbq.Owner) domain.OwnerSettings {
	return domain.OwnerSettings{
		AI: domain.OwnerAISettings{
			Provider:      o.AiProvider,
			KeyConfigured: len(o.AiProviderKeyEnc) > 0,
		},
		BYOAI: domain.OwnerBYOAISettings{
			Enabled:     o.ByoaiEnabled,
			Providers:   decodeProviders(o.ByoaiProviders),
			PublicBlurb: o.ByoaiPublicBlurb,
		},
	}
}

// decodeProviders 把 byoai_providers jsonb 解到 []string。空 / 解失败返 nil；
// usecase 视 nil 为 "default providers"，handler 编码时按 [] 输出。
func decodeProviders(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
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
func (r *OwnerRepo) UpdateBYOAI(
	ctx context.Context, in *UpdateBYOAIInput,
) (domain.OwnerSettings, error) {
	params, perr := buildBYOAIParams(in)
	if perr != nil {
		return domain.OwnerSettings{}, perr
	}
	q := dbq.New(r.pool)
	row, uerr := q.UpdateOwnerBYOAI(ctx, params)
	if uerr != nil {
		if errors.Is(uerr, pgxErrNoRows()) {
			return domain.OwnerSettings{}, domain.ErrOwnerNotFound
		}
		return domain.OwnerSettings{}, fmt.Errorf("update byoai: %w", uerr)
	}
	return toOwnerSettings(&row), nil
}

// GetSettings —— 拉 owner 行的 settings 切面（不含 identity）。
// /me 端要 owner + settings 拼起来时调它，跟 GetByID 各自只取自己那半。
func (r *OwnerRepo) GetSettings(
	ctx context.Context, ownerID string,
) (domain.OwnerSettings, error) {
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.OwnerSettings{}, fmt.Errorf("parse owner id: %w", perr)
	}
	q := dbq.New(r.pool)
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return domain.OwnerSettings{}, domain.ErrOwnerNotFound
		}
		return domain.OwnerSettings{}, fmt.Errorf("get owner settings: %w", err)
	}
	return toOwnerSettings(&row), nil
}

// buildBYOAIParams 把入参 normalize + marshal 一气呵成，让 UpdateBYOAI
// 自己 cyclo ≤ 5。
func buildBYOAIParams(in *UpdateBYOAIInput) (dbq.UpdateOwnerBYOAIParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.UpdateOwnerBYOAIParams{}, fmt.Errorf("parse owner id: %w", err)
	}
	providers := in.Providers
	if providers == nil {
		providers = []string{}
	}
	encoded, merr := json.Marshal(providers)
	if merr != nil {
		return dbq.UpdateOwnerBYOAIParams{}, fmt.Errorf("marshal providers: %w", merr)
	}
	return dbq.UpdateOwnerBYOAIParams{
		ID:               ownerUUID,
		ByoaiEnabled:     in.Enabled,
		ByoaiProviders:   encoded,
		ByoaiPublicBlurb: in.Blurb,
	}, nil
}

// UpdateAIProviderInput —— admin "AI provider" 表单的 commit 入参。
// KeyPlaintext == nil 表示不动 key（只改 provider）；空 string 显式清掉 key。
type UpdateAIProviderInput struct {
	KeyPlaintext *string
	OwnerID      string
	Provider     string
}

// AIProviderView —— inference resolver 需要的最小信息：provider id +
// encrypted key bytes。明文 key 由 caller 走 cryptobox.Decrypt 解。
type AIProviderView struct {
	Provider string
	KeyEnc   []byte
}

// GetAIProviderView —— 拉 owner 的 AI provider 配置（不返其它字段）。
// resolver 不该 import postgres，所以这个方法返一个独立的 view 类型；
// cmd/server 用 adapter 把它包成 inference.OwnerKeyView。
func (r *OwnerRepo) GetAIProviderView(
	ctx context.Context, ownerID string,
) (AIProviderView, error) {
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return AIProviderView{}, fmt.Errorf("parse owner id: %w", perr)
	}
	q := dbq.New(r.pool)
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AIProviderView{}, domain.ErrOwnerNotFound
		}
		return AIProviderView{}, fmt.Errorf("get owner for provider view: %w", err)
	}
	return AIProviderView{Provider: row.AiProvider, KeyEnc: row.AiProviderKeyEnc}, nil
}

// UpdateAIProvider —— commit owner 的 AI provider 选择。当 KeyPlaintext 非
// nil 时同步换 ai_provider_key_enc；为 nil 时保留原 key（仅切 provider）。
// 返回新 OwnerSettings（聚合的独立切面）。
func (r *OwnerRepo) UpdateAIProvider(
	ctx context.Context, in *UpdateAIProviderInput,
) (domain.OwnerSettings, error) {
	pgID, perr := parseUUID(in.OwnerID)
	if perr != nil {
		return domain.OwnerSettings{}, fmt.Errorf("parse owner id: %w", perr)
	}
	encBytes, eerr := r.resolveKeyBytes(ctx, pgID, in.KeyPlaintext)
	if eerr != nil {
		return domain.OwnerSettings{}, eerr
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateOwnerAIProvider(ctx, dbq.UpdateOwnerAIProviderParams{
		ID: pgID, AiProvider: in.Provider, AiProviderKeyEnc: encBytes,
	})
	if qerr != nil {
		return domain.OwnerSettings{}, fmt.Errorf("update ai provider: %w", qerr)
	}
	return toOwnerSettings(&row), nil
}

// UpdateHandle —— owner 改 handle 一组 atomic：先读旧 handle、UPDATE owners
// 设新 handle、把旧 handle 写进 handle_aliases。一个事务里完成；唯一约束
// 冲突（handle 被别人占）翻译成 domain.ErrHandleTaken。
func (r *OwnerRepo) UpdateHandle(
	ctx context.Context, ownerID, newHandle string,
) (domain.Owner, error) {
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.Owner{}, fmt.Errorf("parse owner id: %w", perr)
	}
	tx, terr := r.pool.Begin(ctx)
	if terr != nil {
		return domain.Owner{}, fmt.Errorf("begin tx: %w", terr)
	}
	owner, txErr := updateHandleTx(ctx, tx, pgID, newHandle)
	return commitOrRollback(ctx, tx, &owner, txErr, "commit update handle")
}

// commitOrRollback —— tx 收尾通用 helper：txErr 非 nil 就 rollback；nil 就
// commit。让 UpdateHandle 自己 cyclo 友好。owner 用 pointer 避免 hugeParam。
func commitOrRollback(
	ctx context.Context, tx pgx.Tx, owner *domain.Owner, txErr error, commitTag string,
) (domain.Owner, error) {
	if txErr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			return domain.Owner{}, errors.Join(txErr, fmt.Errorf("rollback: %w", rerr))
		}
		return domain.Owner{}, txErr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return domain.Owner{}, fmt.Errorf("%s: %w", commitTag, cerr)
	}
	return *owner, nil
}

func updateHandleTx(
	ctx context.Context, tx pgx.Tx, ownerID pgtype.UUID, newHandle string,
) (domain.Owner, error) {
	q := dbq.New(tx)
	old, gerr := q.GetOwnerByID(ctx, ownerID)
	if gerr != nil {
		return domain.Owner{}, fmt.Errorf("get owner: %w", gerr)
	}
	if old.Handle == newHandle {
		return toDomainOwner(&old), nil
	}
	if uerr := doUpdateHandle(ctx, q, ownerID, newHandle); uerr != nil {
		return domain.Owner{}, uerr
	}
	aliasParams := dbq.AddHandleAliasParams{Handle: old.Handle, OwnerID: ownerID}
	if aerr := q.AddHandleAlias(ctx, aliasParams); aerr != nil {
		return domain.Owner{}, fmt.Errorf("add alias: %w", aerr)
	}
	old.Handle = newHandle
	return toDomainOwner(&old), nil
}

func doUpdateHandle(
	ctx context.Context, q *dbq.Queries, ownerID pgtype.UUID, newHandle string,
) error {
	_, err := q.UpdateOwnerHandle(ctx, dbq.UpdateOwnerHandleParams{ID: ownerID, Handle: newHandle})
	if err == nil {
		return nil
	}
	constraint, isUnique := pgUniqueViolation(err)
	if isUnique && constraint == "owners_handle_key" {
		return domain.ErrHandleTaken
	}
	return fmt.Errorf("update handle: %w", err)
}

// resolveKeyBytes —— KeyPlaintext nil 时复用原 enc bytes；非 nil 时空字符串
// 清空（[]byte{}），非空字符串用 cryptobox 加密。给 UpdateAIProvider 用。
func (r *OwnerRepo) resolveKeyBytes(
	ctx context.Context, pgID pgtype.UUID, key *string,
) ([]byte, error) {
	if key == nil {
		row, err := dbq.New(r.pool).GetOwnerByID(ctx, pgID)
		if err != nil {
			return nil, fmt.Errorf("get owner for key carryover: %w", err)
		}
		return row.AiProviderKeyEnc, nil
	}
	if *key == "" {
		return []byte{}, nil
	}
	encBytes, err := cryptobox.Encrypt([]byte(*key))
	if err != nil {
		return nil, fmt.Errorf("encrypt ai key: %w", err)
	}
	return encBytes, nil
}
