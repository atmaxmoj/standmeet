// mail_connectors.go —— owner_mail_connectors repo。username/password 通过
// cryptobox AES-256-GCM 落盘加密;repo 在边界做加解密,对 usecases 只暴露明文
// MailConnector。host/port/from 非密,明文存。

package connector

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// MailRepo —— owner 出站 SMTP connector。
type MailRepo struct {
	pool *pgstore.Pool
}

// NewMailRepo 构造 MailRepo。
func NewMailRepo(pool *pgstore.Pool) *MailRepo { return &MailRepo{pool: pool} }

// SaveMailConnectorInput —— owner 填 SMTP 配置后入参。
type SaveMailConnectorInput struct {
	OwnerID     string
	Provider    string
	Host        string
	Username    string
	Password    string
	FromAddress string
	FromName    string
	Port        int
}

// SaveConnector —— upsert SMTP 配置,username/password 加密落盘。改配置会清
// connected_at(query 里),owner 必须重新 test。
func (r *MailRepo) SaveConnector(ctx context.Context, in *SaveMailConnectorInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	aad := []byte(in.OwnerID) // 密文绑到 owner_id;decode 用同一 owner 串解。
	userEnc, uerr := pgstore.MaybeEncrypt(in.Username, aad)
	if uerr != nil {
		return fmt.Errorf("encrypt smtp username: %w", uerr)
	}
	passEnc, perr := pgstore.MaybeEncrypt(in.Password, aad)
	if perr != nil {
		return fmt.Errorf("encrypt smtp password: %w", perr)
	}
	if _, qerr := db.New(r.pool).UpsertMailConnector(ctx, db.UpsertMailConnectorParams{
		OwnerID:     ownerUUID,
		Provider:    in.Provider,
		Host:        in.Host,
		Port:        int32(in.Port),
		UsernameEnc: userEnc,
		PasswordEnc: passEnc,
		FromAddress: in.FromAddress,
		FromName:    in.FromName,
	}); qerr != nil {
		return fmt.Errorf("upsert mail connector: %w", qerr)
	}
	return nil
}

// GetConnector —— 加载并解密。无行返回空 connector(OwnerID/Provider 填好)。
func (r *MailRepo) GetConnector(
	ctx context.Context, ownerID, provider string,
) (MailConnector, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return MailConnector{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetMailConnector(ctx,
		db.GetMailConnectorParams{OwnerID: ownerUUID, Provider: provider})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return MailConnector{OwnerID: ownerID, Provider: provider}, nil
		}
		return MailConnector{}, fmt.Errorf("get mail connector: %w", qerr)
	}
	return decodeMailConnector(&row, ownerID)
}

// MarkConnected —— test send 成功后标记 connected。
func (r *MailRepo) MarkConnected(ctx context.Context, ownerID, provider string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if merr := db.New(r.pool).MarkMailConnected(ctx,
		db.MarkMailConnectedParams{OwnerID: ownerUUID, Provider: provider}); merr != nil {
		return fmt.Errorf("mark mail connected: %w", merr)
	}
	return nil
}

// SetOTP —— 存一份待验 OTP(sha256 hash + 过期),重置尝试计数。
func (r *MailRepo) SetOTP(
	ctx context.Context, ownerID, provider string, hash []byte, expiresAt time.Time,
) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if serr := db.New(r.pool).SetMailOTP(ctx, db.SetMailOTPParams{
		OwnerID: ownerUUID, Provider: provider,
		OtpHash: hash, OtpExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	}); serr != nil {
		return fmt.Errorf("set mail otp: %w", serr)
	}
	return nil
}

// IncOTPAttempts —— 验码错一次,尝试计数 +1,返回新值。
func (r *MailRepo) IncOTPAttempts(ctx context.Context, ownerID, provider string) (int, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return 0, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	n, ierr := db.New(r.pool).IncMailOTPAttempts(ctx,
		db.IncMailOTPAttemptsParams{OwnerID: ownerUUID, Provider: provider})
	if ierr != nil {
		return 0, fmt.Errorf("inc mail otp attempts: %w", ierr)
	}
	return int(n), nil
}

// ClearOTP —— 作废当前 OTP。
func (r *MailRepo) ClearOTP(ctx context.Context, ownerID, provider string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if cerr := db.New(r.pool).ClearMailOTP(ctx,
		db.ClearMailOTPParams{OwnerID: ownerUUID, Provider: provider}); cerr != nil {
		return fmt.Errorf("clear mail otp: %w", cerr)
	}
	return nil
}

// DeleteConnector —— hard disconnect。
func (r *MailRepo) DeleteConnector(ctx context.Context, ownerID, provider string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).DeleteMailConnector(ctx,
		db.DeleteMailConnectorParams{OwnerID: ownerUUID, Provider: provider}); derr != nil {
		return fmt.Errorf("delete mail connector: %w", derr)
	}
	return nil
}

func decodeMailConnector(
	row *db.OwnerMailConnector, ownerID string,
) (MailConnector, error) {
	aad := []byte(ownerID) // 与 SaveConnector 的 in.OwnerID 同串。
	user, uerr := pgstore.DecryptOrEmpty(row.UsernameEnc, aad)
	if uerr != nil {
		return MailConnector{}, fmt.Errorf("decrypt username: %w", uerr)
	}
	pass, perr := pgstore.DecryptOrEmpty(row.PasswordEnc, aad)
	if perr != nil {
		return MailConnector{}, fmt.Errorf("decrypt password: %w", perr)
	}
	out := MailConnector{
		OwnerID: ownerID, Provider: row.Provider,
		Host: row.Host, Port: int(row.Port),
		Username: user, Password: pass,
		FromAddress: row.FromAddress, FromName: row.FromName,
		OTPHash: row.OtpHash, OTPAttempts: int(row.OtpAttempts),
	}
	if row.ConnectedAt.Valid {
		t := row.ConnectedAt.Time
		out.ConnectedAt = &t
	}
	if row.OtpExpiresAt.Valid {
		t := row.OtpExpiresAt.Time
		out.OTPExpiresAt = &t
	}
	return out, nil
}
