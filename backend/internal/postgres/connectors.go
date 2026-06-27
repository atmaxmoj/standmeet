// connectors.go —— #155 统一连接器连接状态 repo（owner_connectors）。repo 边界加解密：凭据/
// token 加密落库，读出时解密成 domain.ConnectorConnection（明文只在 connector 层内存活）。
// 替代 calendar.go/mail_connectors.go 的 gcal/smtp-specific repo（swap 落地后删）。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// ConnectorRepo —— owner_connectors 的读写。
type ConnectorRepo struct{ pool *Pool }

// NewConnectorRepo —— composition root 注入连接池。
func NewConnectorRepo(pool *Pool) *ConnectorRepo { return &ConnectorRepo{pool: pool} }

// SaveConnectorCredsInput —— 存凭据入参（明文凭据 JSON，repo 内加密）。
type SaveConnectorCredsInput struct {
	OwnerID     string
	ConnectorID string
	Category    string
	Kind        string
	Credentials []byte
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
func (r *ConnectorRepo) SaveCredentials(ctx context.Context, in *SaveConnectorCredsInput) error {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	enc, eerr := encBytes(in.Credentials)
	if eerr != nil {
		return eerr
	}
	_, qerr := dbq.New(r.pool).UpsertConnectorCredentials(ctx, dbq.UpsertConnectorCredentialsParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID,
		Category: in.Category, Kind: in.Kind, CredentialsEnc: enc,
	})
	if qerr != nil {
		return fmt.Errorf("upsert connector credentials: %w", qerr)
	}
	return nil
}

// SaveTokens —— 存 OAuth token（首次或 refresh）。首次拿到 token → connected。
func (r *ConnectorRepo) SaveTokens(ctx context.Context, in *SaveConnectorTokensInput) error {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	tokEnc, terr := encryptToken(in.AccessToken, in.RefreshToken)
	if terr != nil {
		return terr
	}
	scopesJSON, serr := json.Marshal(in.Scopes)
	if serr != nil {
		return fmt.Errorf("marshal scopes: %w", serr)
	}
	_, qerr := dbq.New(r.pool).UpdateConnectorTokens(ctx, dbq.UpdateConnectorTokensParams{
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
func (r *ConnectorRepo) MarkConnected(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).MarkConnectorConnected(ctx, dbq.MarkConnectorConnectedParams{
		OwnerID: ownerUUID, ConnectorID: connectorID,
	}); derr != nil {
		return fmt.Errorf("mark connector connected: %w", derr)
	}
	return nil
}

// ClearTokens —— soft disconnect：擦 token+connected+active，保留 credentials。
func (r *ConnectorRepo) ClearTokens(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).ClearConnectorTokens(ctx,
		dbq.ClearConnectorTokensParams{OwnerID: ownerUUID, ConnectorID: connectorID}); derr != nil {
		return fmt.Errorf("clear connector tokens: %w", derr)
	}
	return nil
}

// SetActive —— 把目标置 active、同品类其余置非 active（§9 槽位规则）。
func (r *ConnectorRepo) SetActive(
	ctx context.Context, ownerID, connectorID, category string,
) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).SetActiveConnector(ctx, dbq.SetActiveConnectorParams{
		ConnectorID: connectorID, OwnerID: ownerUUID, Category: category,
	}); derr != nil {
		return fmt.Errorf("set active connector: %w", derr)
	}
	return nil
}

// Delete —— hard disconnect：删行，回到从未连过的状态。
func (r *ConnectorRepo) Delete(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).DeleteConnector(ctx,
		dbq.DeleteConnectorParams{OwnerID: ownerUUID, ConnectorID: connectorID}); derr != nil {
		return fmt.Errorf("delete connector: %w", derr)
	}
	return nil
}

// Get —— 加载并解密一个连接器的连接状态。无行 → 空 ConnectorConnection（从未连过）。
func (r *ConnectorRepo) Get(
	ctx context.Context, ownerID, connectorID string,
) (domain.ConnectorConnection, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.ConnectorConnection{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).GetConnector(ctx,
		dbq.GetConnectorParams{OwnerID: ownerUUID, ConnectorID: connectorID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.ConnectorConnection{ConnectorID: connectorID}, nil
		}
		return domain.ConnectorConnection{}, fmt.Errorf("get connector: %w", qerr)
	}
	return decodeConnectorConn(&row)
}

// ListByOwner —— owner 所有连接器的连接状态（admin 列表）。
func (r *ConnectorRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]domain.ConnectorConnection, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListConnectorsByOwner(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list connectors: %w", qerr)
	}
	return decodeConnectorConns(rows)
}

// ListByCategory —— owner 某品类的连接器（槽位解析）。
func (r *ConnectorRepo) ListByCategory(
	ctx context.Context, ownerID, category string,
) ([]domain.ConnectorConnection, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListConnectorsByCategory(ctx,
		dbq.ListConnectorsByCategoryParams{OwnerID: ownerUUID, Category: category})
	if qerr != nil {
		return nil, fmt.Errorf("list connectors by category: %w", qerr)
	}
	return decodeConnectorConns(rows)
}

// ─── 加解密 helpers ───

func encBytes(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return []byte{}, nil
	}
	out, err := cryptobox.Encrypt(b)
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}
	return out, nil
}

func decBytes(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return []byte{}, nil
	}
	out, err := cryptobox.Decrypt(b)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}
	return out, nil
}

func encryptToken(access, refresh string) ([]byte, error) {
	raw, err := json.Marshal(tokenBlob{AccessToken: access, RefreshToken: refresh})
	if err != nil {
		return nil, fmt.Errorf("marshal token: %w", err)
	}
	return encBytes(raw)
}

func decodeToken(enc []byte) (tokenBlob, error) {
	var tb tokenBlob
	raw, err := decBytes(enc)
	if err != nil {
		return tb, err
	}
	if len(raw) == 0 {
		return tb, nil
	}
	if uerr := json.Unmarshal(raw, &tb); uerr != nil {
		return tb, fmt.Errorf("decode token: %w", uerr)
	}
	return tb, nil
}

func decodeScopes(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	var scopes []string
	if err := json.Unmarshal(raw, &scopes); err != nil {
		return nil, fmt.Errorf("decode scopes: %w", err)
	}
	return scopes, nil
}

func decodeConnectorConn(row *dbq.OwnerConnector) (domain.ConnectorConnection, error) {
	creds, err := decBytes(row.CredentialsEnc)
	if err != nil {
		return domain.ConnectorConnection{}, err
	}
	tok, terr := decodeToken(row.TokenEnc)
	if terr != nil {
		return domain.ConnectorConnection{}, terr
	}
	scopes, serr := decodeScopes(row.Scopes)
	if serr != nil {
		return domain.ConnectorConnection{}, serr
	}
	conn := domain.ConnectorConnection{
		ConnectorID: row.ConnectorID, Category: row.Category, Kind: row.Kind,
		AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
		Credentials: creds, Scopes: scopes,
		Connected: row.ConnectedAt.Valid, Active: row.Active,
	}
	if row.TokenExpiresAt.Valid {
		t := row.TokenExpiresAt.Time
		conn.TokenExpiresAt = &t
	}
	return conn, nil
}

func decodeConnectorConns(rows []dbq.OwnerConnector) ([]domain.ConnectorConnection, error) {
	out := make([]domain.ConnectorConnection, 0, len(rows))
	for i := range rows {
		conn, err := decodeConnectorConn(&rows[i])
		if err != nil {
			return nil, err
		}
		out = append(out, conn)
	}
	return out, nil
}
