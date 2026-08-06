// providers.go —— owner_providers 的读写:owner 的 provider 本子。
//
// 一份 → 一本。原来 owner 行上四列(ai_provider / ai_provider_key_enc / ai_endpoint / ai_model),
// 现在是一张表、其中一条 is_default。code / role 各自可以指一条,解析顺序
// `byoai > code > role > 默认` —— 顺序在 usecase 那一侧,这一层只负责取。
//
// **key_enc 出这一层时仍然是封着的。** 开封只发生在组装那一侧(cmd/server/unseal.go),
// 这是 §1.5 那条不变量,由 check-core-seals-only.sh 看着。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// ProviderRow —— 本子里的一条。KeyEnc 是密文(本域不开封)。
type ProviderRow struct {
	GasTokens     *int64
	OwnerID       string
	ID            string
	Label         string
	Provider      string
	Endpoint      string
	Model         string
	KeyEnc        []byte
	IsDefault     bool
	KeyConfigured bool
}

// CreateProviderInput —— 建一条。Key 是**已经封好的**密文;明文不进这一层。
type CreateProviderInput struct {
	OwnerID   string
	Label     string
	Provider  string
	Endpoint  string
	Model     string
	KeyEnc    []byte
	IsDefault bool
}

// providerKey —— 定位一条 provider 要的两个 uuid。
type providerKey struct {
	owner pgtype.UUID
	id    pgtype.UUID
}

// parseProviderKey —— 两个 id 一起解。provider id 解不动**不是**格式错,是
// "本子里没这条"(调用方给的 id 从哪来的都可能) → ErrProviderNotFound,跟查不到同一个回答。
func parseProviderKey(ownerID, id string) (providerKey, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return providerKey{}, fmt.Errorf(parseOwnerIDErrFmt, oerr)
	}
	idUUID, ierr := pgstore.ParseUUID(id)
	if ierr != nil {
		return providerKey{}, entity.ErrProviderNotFound
	}
	return providerKey{owner: ownerUUID, id: idUUID}, nil
}

func toProviderRow(p *db.OwnerProvider) ProviderRow {
	return ProviderRow{
		ID: pgstore.FormatUUID(p.ID), OwnerID: pgstore.FormatUUID(p.OwnerID),
		Label: p.Label, Provider: p.Provider,
		Endpoint: p.Endpoint, Model: p.Model, KeyEnc: p.KeyEnc,
		IsDefault: p.IsDefault, KeyConfigured: len(p.KeyEnc) > 0,
		GasTokens: p.GasTokens,
	}
}

// CreateProviderPlainInput —— 带**明文** key 的建条入参。封在这一层做(只封不解,§1.5),
// 上面那层拿不到密文也不需要知道加密这回事。
type CreateProviderPlainInput struct {
	OwnerID      string
	Label        string
	Provider     string
	Endpoint     string
	Model        string
	KeyPlaintext string
	IsDefault    bool
}

// CreateProviderPlain —— 收明文 key,封上再落。空 key = 这条还没配 key(合法:owner 可以先
// 建条目后填 key)。
func (r *Repo) CreateProviderPlain(
	ctx context.Context, in *CreateProviderPlainInput,
) (ProviderRow, error) {
	enc, eerr := sealProviderKey(in.OwnerID, &in.KeyPlaintext)
	if eerr != nil {
		return ProviderRow{}, eerr
	}
	return r.CreateProvider(ctx, &CreateProviderInput{
		OwnerID: in.OwnerID, Label: in.Label, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model, KeyEnc: enc, IsDefault: in.IsDefault,
	})
}

// CreateProvider —— 新建一条。is_default 由调用方决定;要设默认的话调用方先 ClearDefault
// (两步都在 usecase 里,顺序错了会撞上那条 partial unique index —— 那正是它存在的意义)。
func (r *Repo) CreateProvider(
	ctx context.Context, in *CreateProviderInput,
) (ProviderRow, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return ProviderRow{}, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	row, qerr := db.New(r.pool).CreateOwnerProvider(ctx, db.CreateOwnerProviderParams{
		OwnerID: ownerUUID, Label: in.Label, Provider: in.Provider,
		KeyEnc: in.KeyEnc, Endpoint: in.Endpoint, Model: in.Model,
		IsDefault: in.IsDefault,
	})
	if qerr != nil {
		return ProviderRow{}, fmt.Errorf("create owner provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

// ListProviders —— 本子,默认那条在最前。
func (r *Repo) ListProviders(ctx context.Context, ownerID string) ([]ProviderRow, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	rows, qerr := db.New(r.pool).ListOwnerProviders(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list owner providers: %w", qerr)
	}
	out := make([]ProviderRow, 0, len(rows))
	for i := range rows {
		out = append(out, toProviderRow(&rows[i]))
	}
	return out, nil
}

// GetProvider —— 一条(owner-scoped)。找不到 → ErrProviderNotFound。
func (r *Repo) GetProvider(
	ctx context.Context, ownerID, id string,
) (ProviderRow, error) {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return ProviderRow{}, perr
	}
	row, qerr := db.New(r.pool).GetOwnerProvider(ctx,
		db.GetOwnerProviderParams{ID: key.id, OwnerID: key.owner})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ProviderRow{}, entity.ErrProviderNotFound
		}
		return ProviderRow{}, fmt.Errorf("get owner provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

// DefaultProvider —— 默认那条。一个 owner 没有默认 → ErrProviderNotFound
// (那是解析链的地板:再往下没有可退的了)。
func (r *Repo) DefaultProvider(ctx context.Context, ownerID string) (ProviderRow, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return ProviderRow{}, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	row, qerr := db.New(r.pool).GetDefaultOwnerProvider(ctx, ownerUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ProviderRow{}, entity.ErrProviderNotFound
		}
		return ProviderRow{}, fmt.Errorf("get default provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

// UpdateProviderInput —— 部分更新:nil = 不动那个字段。SetGas 是三态的第三态
// (SetGas=true + GasTokens=nil 才是"取消计量")。
type UpdateProviderInput struct {
	Label     *string
	Provider  *string
	Endpoint  *string
	Model     *string
	GasTokens *int64
	OwnerID   string
	ID        string
	SetGas    bool
}

// UpdateProvider —— 部分更新。找不到 → ErrProviderNotFound(:one 的 no-rows)。
func (r *Repo) UpdateProvider(
	ctx context.Context, in *UpdateProviderInput,
) (ProviderRow, error) {
	params, perr := buildUpdateProviderParams(in)
	if perr != nil {
		return ProviderRow{}, perr
	}
	row, qerr := db.New(r.pool).UpdateOwnerProvider(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ProviderRow{}, entity.ErrProviderNotFound
		}
		return ProviderRow{}, fmt.Errorf("update owner provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

func buildUpdateProviderParams(
	in *UpdateProviderInput,
) (db.UpdateOwnerProviderParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return db.UpdateOwnerProviderParams{}, fmt.Errorf(parseOwnerIDErrFmt, oerr)
	}
	idUUID, ierr := pgstore.ParseUUID(in.ID)
	if ierr != nil {
		return db.UpdateOwnerProviderParams{}, entity.ErrProviderNotFound
	}
	return db.UpdateOwnerProviderParams{
		ID: idUUID, OwnerID: ownerUUID,
		Label: in.Label, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model,
		SetGas: in.SetGas, GasTokens: in.GasTokens,
	}, nil
}

// SetProviderKey —— 换一把 key(已封好的密文)。0 行 = 没这条 → ErrProviderNotFound。
// "key 存好了"说给一条不存在的行听,跟吊销了个不存在的东西是同一种谎。
func (r *Repo) SetProviderKey(ctx context.Context, ownerID, id string, keyEnc []byte) error {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return perr
	}
	rows, qerr := db.New(r.pool).SetOwnerProviderKey(ctx, db.SetOwnerProviderKeyParams{
		ID: key.id, OwnerID: key.owner, KeyEnc: keyEnc,
	})
	if qerr != nil {
		return fmt.Errorf("set provider key: %w", qerr)
	}
	if rows == 0 {
		return entity.ErrProviderNotFound
	}
	return nil
}

// SetDefaultProvider —— 把默认挪到这一条:先全清,再设。两步之间那条 partial unique index
// 保证不会出现两个默认;设那一步 0 行 = 目标不存在,而那会让这个 owner **一个默认都没有** ——
// 整个 fallback 故事就是踩在它上面的,所以必须报出来。
func (r *Repo) SetDefaultProvider(ctx context.Context, ownerID, id string) error {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return perr
	}
	q := db.New(r.pool)
	if cerr := q.ClearDefaultOwnerProvider(ctx, key.owner); cerr != nil {
		return fmt.Errorf("clear default provider: %w", cerr)
	}
	rows, serr := q.SetDefaultOwnerProvider(ctx,
		db.SetDefaultOwnerProviderParams{ID: key.id, OwnerID: key.owner})
	if serr != nil {
		return fmt.Errorf("set default provider: %w", serr)
	}
	if rows == 0 {
		return entity.ErrProviderNotFound
	}
	return nil
}

// DeleteProvider —— 删一条。SQL 自己带 `AND NOT is_default`,所以 0 行有两种可能:
// 没这条,或者它是默认那条。调用方(usecase)先读一次分得清 —— 这里只报"没删成"。
func (r *Repo) DeleteProvider(ctx context.Context, ownerID, id string) error {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return perr
	}
	rows, qerr := db.New(r.pool).DeleteOwnerProvider(ctx,
		db.DeleteOwnerProviderParams{ID: key.id, OwnerID: key.owner})
	if qerr != nil {
		return fmt.Errorf("delete owner provider: %w", qerr)
	}
	if rows == 0 {
		return entity.ErrProviderNotFound
	}
	return nil
}
