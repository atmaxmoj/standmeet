// connectors_uploaded.go —— #155 上传 openapi 连接器的存档（spec + JSONata binding）。owner 在
// UI 贴的连接器持久化在 owner_connectors 的 spec/binding/auth_scheme 列；拉起时重装进 Hub。
// 内置连接器的这些列为空（manifest 来自 go:embed）。

package connector

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SaveUploadedInput —— owner 自建连接器的存储入参（openapi: spec/binding；protocol: protocol）。
type SaveUploadedInput struct {
	OwnerID            string
	ConnectorID        string
	Category           string
	Kind               string
	AuthScheme         string
	Protocol           string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// SaveUploaded —— 存一个 owner 自建连接器（openapi 带 spec/binding；protocol 带 protocol）。
func (r *Repo) SaveUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if _, qerr := db.New(r.pool).InsertUploadedConnector(ctx, db.InsertUploadedConnectorParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID, Category: in.Category,
		Kind: in.Kind, Spec: in.Spec, Binding: in.Binding,
		AuthScheme: in.AuthScheme, Protocol: in.Protocol,
		ExposeAsAgentTools: in.ExposeAsAgentTools,
	}); qerr != nil {
		return fmt.Errorf("insert uploaded connector: %w", qerr)
	}
	return nil
}

// UpdateUploaded —— 编辑已建上传连接器的 spec/binding/auth_scheme/category（重新装配后存档）。
func (r *Repo) UpdateUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).UpdateUploadedConnector(ctx, db.UpdateUploadedConnectorParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID, Category: in.Category,
		Spec: in.Spec, Binding: in.Binding, AuthScheme: in.AuthScheme,
		ExposeAsAgentTools: in.ExposeAsAgentTools,
	}); qerr != nil {
		return fmt.Errorf("update uploaded connector: %w", qerr)
	}
	return nil
}

// UploadedManifest —— 一个 owner 自建连接器的存档 manifest（拉起重装用）。
type UploadedManifest struct {
	ConnectorID        string
	Category           string
	Kind               string
	AuthScheme         string
	Protocol           string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// GetManifest —— 取一个连接器存档的 manifest 字段（上传连接器用：category/kind/spec/binding/
// auth_scheme）。无行（或内置无 spec 的行）→ 返回 Spec 为空的零值；调用方据「Spec 空 = 非
// 上传连接器」判定。
func (r *Repo) GetManifest(
	ctx context.Context, ownerID, connectorID string,
) (UploadedManifest, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return UploadedManifest{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetConnectorManifest(ctx,
		db.GetConnectorManifestParams{OwnerID: ownerUUID, ConnectorID: connectorID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return UploadedManifest{}, nil
		}
		return UploadedManifest{}, fmt.Errorf("get connector manifest: %w", qerr)
	}
	return UploadedManifest{
		Spec: row.Spec, Binding: row.Binding, ConnectorID: connectorID,
		Category: row.Category, Kind: row.Kind, AuthScheme: row.AuthScheme,
		Protocol: row.Protocol, ExposeAsAgentTools: row.ExposeAsAgentTools,
	}, nil
}

// DeleteUploaded —— 删一个 owner 自建连接器（行删除）。它填的品类槽随之空。
func (r *Repo) DeleteUploaded(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).DeleteUploadedConnector(ctx, db.DeleteUploadedConnectorParams{
		OwnerID: ownerUUID, ConnectorID: connectorID,
	}); qerr != nil {
		return fmt.Errorf("delete uploaded connector: %w", qerr)
	}
	return nil
}

// ListUploaded —— 所有上传的连接器 manifest（拉起重装，跨 owner；v1 单 owner）。
func (r *Repo) ListUploaded(ctx context.Context) ([]UploadedManifest, error) {
	rows, err := db.New(r.pool).ListUploadedConnectors(ctx)
	if err != nil {
		return nil, fmt.Errorf("list uploaded connectors: %w", err)
	}
	out := make([]UploadedManifest, 0, len(rows))
	for i := range rows {
		out = append(out, UploadedManifest{
			Spec: rows[i].Spec, Binding: rows[i].Binding,
			ConnectorID: rows[i].ConnectorID, Category: rows[i].Category,
			Kind: rows[i].Kind, AuthScheme: rows[i].AuthScheme, Protocol: rows[i].Protocol,
			ExposeAsAgentTools: rows[i].ExposeAsAgentTools,
		})
	}
	return out, nil
}
