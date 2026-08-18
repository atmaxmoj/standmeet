// connectors.go —— #155 统一连接器连接状态 repo（owner_connectors）。repo 边界加解密：凭据/
// token 加密落库，读出时解密成 Connection（明文只在 connector 层内存活）。
// 替代 calendar.go/mail_connectors.go 的 gcal/smtp-specific repo（swap 落地后删）。

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Repo —— owner_connectors 的读写。
type Repo struct{ pool *pgstore.Pool }

// NewRepo —— composition root 注入连接池。
func NewRepo(pool *pgstore.Pool) *Repo { return &Repo{pool: pool} }

// SaveConnectorCredsInput —— 存凭据入参（明文凭据 JSON，repo 内加密）。
type SaveConnectorCredsInput struct {
	OwnerID     string
	ConnectorID string
	Category    string
	Kind        string
	Credentials []byte
	// ResetConnected —— 凭据**真的变了**才置 true：D-5 要求改身份/凭据后重新验证，而那条
	// 规则的前提是「改了」。面板每次点 Connect 都会先存一遍凭据，无条件清掉的话，一条好
	// 连接会在授权开始之前就显示成「没连」（F-C-30）。判断在 usecase 层做，repo 只照办。
	ResetConnected bool
}

// SaveConnectorTokensInput —— 存 OAuth token 入参（明文，repo 内加密）。
type SaveConnectorTokensInput struct {
	ExpiresAt    time.Time
	OwnerID      string
	ConnectorID  string
	AccessToken  string
	RefreshToken string
	Scopes       []string
}

// tokenBlob —— token_enc 里加密 JSON 的形状。
type tokenBlob struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// SaveCredentials —— 存/覆盖连接器凭据（owner 填的 app creds / apiKey / smtp config）。
func (r *Repo) SaveCredentials(ctx context.Context, in *SaveConnectorCredsInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	enc, eerr := encBytes(in.Credentials, []byte(in.OwnerID))
	if eerr != nil {
		return eerr
	}
	_, qerr := db.New(r.pool).UpsertConnectorCredentials(ctx, db.UpsertConnectorCredentialsParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID,
		Category: in.Category, Kind: in.Kind, CredentialsEnc: enc,
		ResetConnected: in.ResetConnected,
	})
	if qerr != nil {
		return fmt.Errorf("upsert connector credentials: %w", qerr)
	}
	return nil
}

// SaveTokens —— 存 OAuth token（首次或 refresh）。首次拿到 token → connected。
func (r *Repo) SaveTokens(ctx context.Context, in *SaveConnectorTokensInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	tokEnc, terr := encryptToken(in.AccessToken, in.RefreshToken, []byte(in.OwnerID))
	if terr != nil {
		return terr
	}
	scopesJSON, serr := json.Marshal(in.Scopes)
	if serr != nil {
		return fmt.Errorf("marshal scopes: %w", serr)
	}
	_, qerr := db.New(r.pool).UpdateConnectorTokens(ctx, db.UpdateConnectorTokensParams{
		TokenEnc:       tokEnc,
		TokenExpiresAt: pgtype.Timestamptz{Time: in.ExpiresAt, Valid: !in.ExpiresAt.IsZero()},
		Scopes:         scopesJSON, OwnerID: ownerUUID, ConnectorID: in.ConnectorID,
	})
	if qerr != nil {
		return fmt.Errorf("update connector tokens: %w", qerr)
	}
	return nil
}

// MarkConnected —— protocol 连接器验证通过（无 oauth dance）→ 标 connected。
//
// **看行数。** 底下是一条 UPDATE:owner 还没有这一行(凭据一次都没存)时它命中 0 行且不报错。
// 不看行数的话,这个函数会对一次什么都没写的调用回 nil,上面就回 `connected: true` —— 卡片
// 当场翻绿,下一次 GET /status 说没连上。行数是这笔写入唯一的回执。
func (r *Repo) MarkConnected(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, derr := db.New(r.pool).MarkConnectorConnected(ctx, db.MarkConnectorConnectedParams{
		OwnerID: ownerUUID, ConnectorID: connectorID,
	})
	if derr != nil {
		return fmt.Errorf("mark connector connected: %w", derr)
	}
	if rows == 0 {
		return fmt.Errorf("mark connector connected %q: %w", connectorID, ErrNoConnection)
	}
	return nil
}

// ClearTokens —— soft disconnect：擦 token+connected+active，保留 credentials。
func (r *Repo) ClearTokens(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).ClearConnectorTokens(ctx,
		db.ClearConnectorTokensParams{OwnerID: ownerUUID, ConnectorID: connectorID}); derr != nil {
		return fmt.Errorf("clear connector tokens: %w", derr)
	}
	return nil
}

// SetActive —— 把目标置 active、同品类其余置非 active（§9 槽位规则）。
//
// **回执是名字,不是行数。** 这条 UPDATE 扫的是整个品类:目标行不存在时,同品类其余仍然被置成
// 非 active —— 行数大于 0,而"激活"的实际结果是这个品类**一个 active 都没有**。所以看返回的
// connector_id 里有没有目标;没有就是 ErrNoConnection,别把"全灭"报成成功。
func (r *Repo) SetActive(
	ctx context.Context, ownerID, connectorID, category string,
) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	touched, derr := db.New(r.pool).SetActiveConnector(ctx, db.SetActiveConnectorParams{
		ConnectorID: connectorID, OwnerID: ownerUUID, Category: category,
	})
	if derr != nil {
		return fmt.Errorf("set active connector: %w", derr)
	}
	if !slices.Contains(touched, connectorID) {
		return fmt.Errorf("set active connector %q: %w", connectorID, ErrNoConnection)
	}
	return nil
}

// Delete —— hard disconnect：删行，回到从未连过的状态。
func (r *Repo) Delete(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).DeleteConnector(ctx,
		db.DeleteConnectorParams{OwnerID: ownerUUID, ConnectorID: connectorID}); derr != nil {
		return fmt.Errorf("delete connector: %w", derr)
	}
	return nil
}

// Get —— 加载并解密一个连接器的连接状态。无行 → 空 ConnectorConnection（从未连过）。
func (r *Repo) Get(
	ctx context.Context, ownerID, connectorID string,
) (Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return Connection{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetConnector(ctx,
		db.GetConnectorParams{OwnerID: ownerUUID, ConnectorID: connectorID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Connection{ConnectorID: connectorID}, nil
		}
		return Connection{}, fmt.Errorf("get connector: %w", qerr)
	}
	return decodeConnectorConn(&row)
}

// ListByOwner —— owner 所有连接器的连接状态（admin 列表）。
func (r *Repo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListConnectorsByOwner(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list connectors: %w", qerr)
	}
	return decodeConnectorConns(rows)
}

// ListByCategory —— owner 某品类的连接器（槽位解析）。
func (r *Repo) ListByCategory(
	ctx context.Context, ownerID, category string,
) ([]Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListConnectorsByCategory(ctx,
		db.ListConnectorsByCategoryParams{OwnerID: ownerUUID, Category: category})
	if qerr != nil {
		return nil, fmt.Errorf("list connectors by category: %w", qerr)
	}
	return decodeConnectorConns(rows)
}

// CategoryConnected —— owner 某品类是否有 active 且已连的连接器（§9 槽位）。
func (r *Repo) CategoryConnected(
	ctx context.Context, ownerID, category string,
) (bool, error) {
	conns, err := r.ListByCategory(ctx, ownerID, category)
	if err != nil {
		return false, err
	}
	for i := range conns {
		if conns[i].Active && conns[i].Connected {
			return true, nil
		}
	}
	return false, nil
}
