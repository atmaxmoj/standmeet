// calendar.go —— owner_calendar_connectors + owner_booking_policy +
// code_bookings 三张表的 repo。token / client_secret 通过 cryptobox
// AES-256-GCM 落盘加密；本 repo 在边界做加解密，对 usecases 只暴露明文
// domain.CalendarConnector。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/cryptobox"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// CalendarRepo —— owner GCal connector + policy + booking history。
type CalendarRepo struct {
	pool *Pool
}

// NewCalendarRepo 构造 CalendarRepo。
func NewCalendarRepo(pool *Pool) *CalendarRepo { return &CalendarRepo{pool: pool} }

// SaveCredentialsInput —— owner 粘 client_id + client_secret 后入参。
type SaveCredentialsInput struct {
	OwnerID      string
	Provider     string
	ClientID     string
	ClientSecret string
}

// SaveCredentials —— upsert client_id + client_secret 加密落盘。
// access_token / refresh_token 故意保留 (改 credentials 不重置 token)。
func (r *CalendarRepo) SaveCredentials(
	ctx context.Context, in *SaveCredentialsInput,
) error {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	idEnc, ierr := cryptobox.Encrypt([]byte(in.ClientID))
	if ierr != nil {
		return fmt.Errorf("encrypt client_id: %w", ierr)
	}
	secEnc, serr := cryptobox.Encrypt([]byte(in.ClientSecret))
	if serr != nil {
		return fmt.Errorf("encrypt client_secret: %w", serr)
	}
	q := dbq.New(r.pool)
	if _, qerr := q.UpsertCalendarCredentials(ctx, dbq.UpsertCalendarCredentialsParams{
		OwnerID:         ownerUUID,
		Provider:        in.Provider,
		ClientIDEnc:     idEnc,
		ClientSecretEnc: secEnc,
	}); qerr != nil {
		return fmt.Errorf("upsert calendar credentials: %w", qerr)
	}
	return nil
}

// SaveTokensInput —— OAuth 拿到 access + refresh token 后入参。
type SaveTokensInput struct {
	OwnerID      string
	Provider     string
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	Scopes       []string
}

// SaveTokens —— OAuth callback / refresh 后写入 token。RefreshToken 空
// 表示 refresh 路径，dbq query 保留旧 refresh_token。
func (r *CalendarRepo) SaveTokens(
	ctx context.Context, in *SaveTokensInput,
) error {
	params, perr := buildSaveTokenParams(in)
	if perr != nil {
		return perr
	}
	if _, qerr := dbq.New(r.pool).UpdateCalendarTokens(ctx, *params); qerr != nil {
		return fmt.Errorf("update calendar tokens: %w", qerr)
	}
	return nil
}

func buildSaveTokenParams(in *SaveTokensInput) (*dbq.UpdateCalendarTokensParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	accessEnc, aerr := cryptobox.Encrypt([]byte(in.AccessToken))
	if aerr != nil {
		return nil, fmt.Errorf("encrypt access_token: %w", aerr)
	}
	refreshEnc, rerr := maybeEncrypt(in.RefreshToken)
	if rerr != nil {
		return nil, rerr
	}
	scopesJSON, jerr := json.Marshal(in.Scopes)
	if jerr != nil {
		return nil, fmt.Errorf("marshal scopes: %w", jerr)
	}
	return &dbq.UpdateCalendarTokensParams{
		OwnerID:              ownerUUID,
		Provider:             in.Provider,
		AccessTokenEnc:       accessEnc,
		RefreshTokenEnc:      refreshEnc,
		AccessTokenExpiresAt: pgtype.Timestamptz{Time: in.ExpiresAt, Valid: true},
		Scopes:               scopesJSON,
	}, nil
}

func maybeEncrypt(plain string) ([]byte, error) {
	if plain == "" {
		return nil, nil
	}
	out, err := cryptobox.Encrypt([]byte(plain))
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}
	return out, nil
}

// GetConnector —— 加载 connector 并解密所有 token 字段。返回的
// domain.CalendarConnector 是明文 in-memory representation。
func (r *CalendarRepo) GetConnector(
	ctx context.Context, ownerID, provider string,
) (domain.CalendarConnector, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.CalendarConnector{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).GetCalendarConnector(ctx,
		dbq.GetCalendarConnectorParams{OwnerID: ownerUUID, Provider: provider})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.CalendarConnector{
				OwnerID: ownerID, Provider: provider,
			}, nil
		}
		return domain.CalendarConnector{}, fmt.Errorf("get calendar connector: %w", qerr)
	}
	return decodeConnector(&row, ownerID)
}

// DeleteConnector —— hard disconnect。删完 owner 等于回到从未连过的状态。
func (r *CalendarRepo) DeleteConnector(
	ctx context.Context, ownerID, provider string,
) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).DeleteCalendarConnector(ctx,
		dbq.DeleteCalendarConnectorParams{OwnerID: ownerUUID, Provider: provider}); derr != nil {
		return fmt.Errorf("delete calendar connector: %w", derr)
	}
	return nil
}

// ClearTokens —— soft disconnect。保留 client_id+secret，只擦 OAuth tokens。
// 下次 Authorize 一键完成（不必重粘 credentials）。
func (r *CalendarRepo) ClearTokens(
	ctx context.Context, ownerID, provider string,
) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).ClearCalendarTokens(ctx,
		dbq.ClearCalendarTokensParams{OwnerID: ownerUUID, Provider: provider}); derr != nil {
		return fmt.Errorf("clear calendar tokens: %w", derr)
	}
	return nil
}

func decodeConnector(
	row *dbq.OwnerCalendarConnector, ownerID string,
) (domain.CalendarConnector, error) {
	tokens, terr := decodeConnectorTokens(row)
	if terr != nil {
		return domain.CalendarConnector{}, terr
	}
	out := domain.CalendarConnector{
		OwnerID: ownerID, Provider: row.Provider,
		ClientID: tokens.clientID, ClientSecret: tokens.clientSecret,
		AccessToken: tokens.access, RefreshToken: tokens.refresh,
		Scopes: decodeStringJSON(row.Scopes),
	}
	attachConnectorTimes(&out, row)
	return out, nil
}

type decodedTokens struct {
	clientID, clientSecret, access, refresh string
}

func decodeConnectorTokens(row *dbq.OwnerCalendarConnector) (decodedTokens, error) {
	var t decodedTokens
	var err error
	if t.clientID, err = decryptOrEmpty(row.ClientIDEnc); err != nil {
		return t, fmt.Errorf("decrypt client_id: %w", err)
	}
	if t.clientSecret, err = decryptOrEmpty(row.ClientSecretEnc); err != nil {
		return t, fmt.Errorf("decrypt client_secret: %w", err)
	}
	if t.access, err = decryptOrEmpty(row.AccessTokenEnc); err != nil {
		return t, fmt.Errorf("decrypt access_token: %w", err)
	}
	if t.refresh, err = decryptOrEmpty(row.RefreshTokenEnc); err != nil {
		return t, fmt.Errorf("decrypt refresh_token: %w", err)
	}
	return t, nil
}

func attachConnectorTimes(out *domain.CalendarConnector, row *dbq.OwnerCalendarConnector) {
	if row.AccessTokenExpiresAt.Valid {
		t := row.AccessTokenExpiresAt.Time
		out.AccessTokenExpiresAt = &t
	}
	if row.ConnectedAt.Valid {
		t := row.ConnectedAt.Time
		out.ConnectedAt = &t
	}
}

func decryptOrEmpty(blob []byte) (string, error) {
	if len(blob) == 0 {
		return "", nil
	}
	plain, err := cryptobox.Decrypt(blob)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plain), nil
}

// booking policy + code_bookings 拆到 calendar_bookings.go，守 350-line cap.
