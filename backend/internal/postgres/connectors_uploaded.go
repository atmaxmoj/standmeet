// connectors_uploaded.go —— #155 上传 openapi 连接器的存档（spec + JSONata binding）。owner 在
// UI 贴的连接器持久化在 owner_connectors 的 spec/binding/auth_scheme 列；拉起时重装进 Hub。
// 内置连接器的这些列为空（manifest 来自 go:embed）。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
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
func (r *ConnectorRepo) SaveUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if _, qerr := dbq.New(r.pool).InsertUploadedConnector(ctx, dbq.InsertUploadedConnectorParams{
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
func (r *ConnectorRepo) UpdateUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	if qerr := dbq.New(r.pool).UpdateUploadedConnector(ctx, dbq.UpdateUploadedConnectorParams{
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
func (r *ConnectorRepo) GetManifest(
	ctx context.Context, ownerID, connectorID string,
) (UploadedManifest, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return UploadedManifest{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).GetConnectorManifest(ctx,
		dbq.GetConnectorManifestParams{OwnerID: ownerUUID, ConnectorID: connectorID})
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

// ListUploaded —— 所有上传的连接器 manifest（拉起重装，跨 owner；v1 单 owner）。
func (r *ConnectorRepo) ListUploaded(ctx context.Context) ([]UploadedManifest, error) {
	rows, err := dbq.New(r.pool).ListUploadedConnectors(ctx)
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
