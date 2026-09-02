// mcp_servers.go — CRUD for mcp_servers + code_mcp_servers. auth_header_value
// is cryptobox AES-256-GCM ciphertext; the repo only moves bytes in and out,
// encryption/decryption is done by the caller (usecase).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/marketplace/db"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

// MCPServerRepo — CRUD for the mcp_servers table + the code_mcp_servers join table.
type MCPServerRepo struct {
	pool *pgstore.Pool
}

// NewMCPServerRepo constructs one.
func NewMCPServerRepo(pool *pgstore.Pool) *MCPServerRepo { return &MCPServerRepo{pool: pool} }

// CreateMCPServerInput — input for Create; the caller has already encrypted the
// auth header value with cryptobox (empty = no auth).
type CreateMCPServerInput struct {
	OwnerID            string
	Name               string
	URL                string
	AuthHeaderName     string
	AuthHeaderValueEnc []byte
}

// Create inserts a new mcp_server row. A name conflict maps to ErrMCPServerNameTaken.
func (r *MCPServerRepo) Create(
	ctx context.Context, in *CreateMCPServerInput,
) (entity.MCPServerConfig, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return entity.MCPServerConfig{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).CreateMCPServer(ctx, db.CreateMCPServerParams{
		OwnerID: ownerUUID, Name: in.Name, Url: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValueEnc: in.AuthHeaderValueEnc,
	})
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "mcp_servers_owner_name_uniq" {
			return entity.MCPServerConfig{}, entity.ErrMCPServerNameTaken
		}
		return entity.MCPServerConfig{}, fmt.Errorf("create mcp server: %w", err)
	}
	return toDomainMCPServer(&row), nil
}

// ListByOwner — admin / MCP list.
func (r *MCPServerRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]entity.MCPServerConfig, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListMCPServersByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list mcp servers: %w", err)
	}
	out := make([]entity.MCPServerConfig, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMCPServer(&rows[i]))
	}
	return out, nil
}

// GetByID — a single row; verifies it belongs to the owner.
func (r *MCPServerRepo) GetByID(
	ctx context.Context, ownerID, serverID string,
) (entity.MCPServerConfig, error) {
	args, perr := parseOwnerAndServerID(ownerID, serverID)
	if perr != nil {
		return entity.MCPServerConfig{}, perr
	}
	row, err := db.New(r.pool).GetMCPServerByID(ctx, db.GetMCPServerByIDParams{
		ID: args.serverUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.MCPServerConfig{}, entity.ErrMCPServerNotFound
		}
		return entity.MCPServerConfig{}, fmt.Errorf("get mcp server: %w", err)
	}
	return toDomainMCPServer(&row), nil
}

// Delete — removes an owner's own server.
func (r *MCPServerRepo) Delete(ctx context.Context, ownerID, serverID string) error {
	args, perr := parseOwnerAndServerID(ownerID, serverID)
	if perr != nil {
		return perr
	}
	if err := db.New(r.pool).DeleteMCPServer(ctx, db.DeleteMCPServerParams{
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

// A.3-IAM-5: SetCodeMCPServers / ListIDsForCode / ListForCode were all removed —
// the code_mcp_servers table has been dropped. MCP servers attach to a Role via
// role_mcp_servers.

// GrantDep — owner explicitly authorizes this server to satisfy a connector
// dependency (idempotent append).
func (r *MCPServerRepo) GrantDep(ctx context.Context, ownerID, serverID, dep string) error {
	args, perr := parseOwnerAndServerID(ownerID, serverID)
	if perr != nil {
		return perr
	}
	if err := db.New(r.pool).GrantMCPServerDep(ctx, db.GrantMCPServerDepParams{
		ID: args.serverUUID, OwnerID: args.ownerUUID, ArrayAppend: dep,
	}); err != nil {
		return fmt.Errorf("grant mcp server dep: %w", err)
	}
	return nil
}

func toDomainMCPServer(row *db.McpServer) entity.MCPServerConfig {
	return entity.MCPServerConfig{
		ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		Name: row.Name, URL: row.Url,
		AuthHeaderName:     row.AuthHeaderName,
		AuthHeaderValueEnc: append([]byte(nil), row.AuthHeaderValueEnc...),
		GrantedDeps:        append([]string(nil), row.GrantedDeps...),
		CreatedAt:          row.CreatedAt.Time,
	}
}
