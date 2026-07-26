// mcp_servers.go —— mcp_servers + code_mcp_servers CRUD。auth_header_value
// 是 cryptobox AES-256-GCM 密文，repo 只搬 bytes 进出，加/解密由 caller
// (usecase) 完成。

package marketplace

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// MCPServerRepo —— mcp_servers 表 + code_mcp_servers join 表 CRUD。
type MCPServerRepo struct {
	pool *pgstore.Pool
}

// NewMCPServerRepo 构造。
func NewMCPServerRepo(pool *pgstore.Pool) *MCPServerRepo { return &MCPServerRepo{pool: pool} }

// CreateMCPServerInput —— Create 入参；caller 已用 cryptobox 加密 auth
// header value (空 = 无 auth)。
type CreateMCPServerInput struct {
	OwnerID            string
	Name               string
	URL                string
	AuthHeaderName     string
	AuthHeaderValueEnc []byte
}

// Create 新建 mcp_server 行。name 冲突翻 ErrMCPServerNameTaken。
func (r *MCPServerRepo) Create(
	ctx context.Context, in *CreateMCPServerInput,
) (MCPServerConfig, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return MCPServerConfig{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).CreateMCPServer(ctx, dbq.CreateMCPServerParams{
		OwnerID: ownerUUID, Name: in.Name, Url: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValueEnc: in.AuthHeaderValueEnc,
	})
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "mcp_servers_owner_name_uniq" {
			return MCPServerConfig{}, ErrMCPServerNameTaken
		}
		return MCPServerConfig{}, fmt.Errorf("create mcp server: %w", err)
	}
	return toDomainMCPServer(&row), nil
}

// ListByOwner —— admin / MCP list。
func (r *MCPServerRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]MCPServerConfig, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListMCPServersByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list mcp servers: %w", err)
	}
	out := make([]MCPServerConfig, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMCPServer(&rows[i]))
	}
	return out, nil
}

// GetByID —— 单条；属于 owner 校验。
func (r *MCPServerRepo) GetByID(
	ctx context.Context, ownerID, serverID string,
) (MCPServerConfig, error) {
	args, perr := parseOwnerAndServerID(ownerID, serverID)
	if perr != nil {
		return MCPServerConfig{}, perr
	}
	row, err := dbq.New(r.pool).GetMCPServerByID(ctx, dbq.GetMCPServerByIDParams{
		ID: args.serverUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MCPServerConfig{}, ErrMCPServerNotFound
		}
		return MCPServerConfig{}, fmt.Errorf("get mcp server: %w", err)
	}
	return toDomainMCPServer(&row), nil
}

// Delete —— 删除 owner 自己的 server。
func (r *MCPServerRepo) Delete(ctx context.Context, ownerID, serverID string) error {
	args, perr := parseOwnerAndServerID(ownerID, serverID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).DeleteMCPServer(ctx, dbq.DeleteMCPServerParams{
		ID: args.serverUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete mcp server: %w", err)
	}
	return nil
}

type serverIDArgs struct {
	serverUUID pgtype.UUID
	ownerUUID  pgtype.UUID
}

func parseOwnerAndServerID(ownerID, serverID string) (serverIDArgs, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return serverIDArgs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	serverUUID, perr := pgstore.ParseUUID(serverID)
	if perr != nil {
		return serverIDArgs{}, fmt.Errorf("parse mcp server id: %w", perr)
	}
	return serverIDArgs{ownerUUID: ownerUUID, serverUUID: serverUUID}, nil
}

// A.3-IAM-5: SetCodeMCPServers / ListIDsForCode / ListForCode 都删了 ——
// code_mcp_servers 表已 drop。MCP servers 通过 role_mcp_servers 挂在 Role 上。

// GrantDep —— owner 显式授权这个 server 接某 connector 依赖（幂等 append）。
func (r *MCPServerRepo) GrantDep(ctx context.Context, ownerID, serverID, dep string) error {
	args, perr := parseOwnerAndServerID(ownerID, serverID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).GrantMCPServerDep(ctx, dbq.GrantMCPServerDepParams{
		ID: args.serverUUID, OwnerID: args.ownerUUID, ArrayAppend: dep,
	}); err != nil {
		return fmt.Errorf("grant mcp server dep: %w", err)
	}
	return nil
}

func toDomainMCPServer(row *dbq.McpServer) MCPServerConfig {
	return MCPServerConfig{
		ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		Name: row.Name, URL: row.Url,
		AuthHeaderName:     row.AuthHeaderName,
		AuthHeaderValueEnc: append([]byte(nil), row.AuthHeaderValueEnc...),
		GrantedDeps:        append([]string(nil), row.GrantedDeps...),
		CreatedAt:          row.CreatedAt.Time,
	}
}
