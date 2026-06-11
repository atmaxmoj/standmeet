// mail_connectors.go —— owner_mail_connectors repo。username/password 通过
// cryptobox AES-256-GCM 落盘加密;repo 在边界做加解密,对 usecases 只暴露明文
// domain.MailConnector。host/port/from 非密,明文存。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// MailRepo —— owner 出站 SMTP connector。
type MailRepo struct {
	pool *Pool
}

// NewMailRepo 构造 MailRepo。
func NewMailRepo(pool *Pool) *MailRepo { return &MailRepo{pool: pool} }

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
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	userEnc, uerr := maybeEncrypt(in.Username)
	if uerr != nil {
		return uerr
	}
	passEnc, perr := maybeEncrypt(in.Password)
	if perr != nil {
		return perr
	}
	if _, qerr := dbq.New(r.pool).UpsertMailConnector(ctx, dbq.UpsertMailConnectorParams{
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
) (domain.MailConnector, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.MailConnector{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).GetMailConnector(ctx,
		dbq.GetMailConnectorParams{OwnerID: ownerUUID, Provider: provider})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.MailConnector{OwnerID: ownerID, Provider: provider}, nil
		}
		return domain.MailConnector{}, fmt.Errorf("get mail connector: %w", qerr)
	}
	return decodeMailConnector(&row, ownerID)
}

// MarkConnected —— test send 成功后标记 connected。
func (r *MailRepo) MarkConnected(ctx context.Context, ownerID, provider string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if merr := dbq.New(r.pool).MarkMailConnected(ctx,
		dbq.MarkMailConnectedParams{OwnerID: ownerUUID, Provider: provider}); merr != nil {
		return fmt.Errorf("mark mail connected: %w", merr)
	}
	return nil
}

// DeleteConnector —— hard disconnect。
func (r *MailRepo) DeleteConnector(ctx context.Context, ownerID, provider string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if derr := dbq.New(r.pool).DeleteMailConnector(ctx,
		dbq.DeleteMailConnectorParams{OwnerID: ownerUUID, Provider: provider}); derr != nil {
		return fmt.Errorf("delete mail connector: %w", derr)
	}
	return nil
}

func decodeMailConnector(
	row *dbq.OwnerMailConnector, ownerID string,
) (domain.MailConnector, error) {
	user, uerr := decryptOrEmpty(row.UsernameEnc)
	if uerr != nil {
		return domain.MailConnector{}, fmt.Errorf("decrypt username: %w", uerr)
	}
	pass, perr := decryptOrEmpty(row.PasswordEnc)
	if perr != nil {
		return domain.MailConnector{}, fmt.Errorf("decrypt password: %w", perr)
	}
	out := domain.MailConnector{
		OwnerID: ownerID, Provider: row.Provider,
		Host: row.Host, Port: int(row.Port),
		Username: user, Password: pass,
		FromAddress: row.FromAddress, FromName: row.FromName,
	}
	if row.ConnectedAt.Valid {
		t := row.ConnectedAt.Time
		out.ConnectedAt = &t
	}
	return out, nil
}
