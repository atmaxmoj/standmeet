// app_state.go — mcp_app_state repo. Cross-refresh state persistence layer for MCP Apps
// (ui:// sandbox cards).
// scope = (member, mcp_id); mcp_id is derived from the tool by the caller (route) and
// passed in — the repo never touches ACL / derivation, it only reads and writes that one
// cell. value is app-defined jsonb; the repo passes it through as an opaque []byte.

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// AppStateRepo — repo for the mcp_app_state table.
type AppStateRepo struct {
	pool *pgstore.Pool
}

// NewAppStateRepo constructs an AppStateRepo.
func NewAppStateRepo(pool *pgstore.Pool) *AppStateRepo { return &AppStateRepo{pool: pool} }

// Set — upserts the value (opaque jsonb) of one cell (ref = member × mcp × key).
func (r *AppStateRepo) Set(
	ctx context.Context, ref entity.AppStateRef, value []byte,
) error {
	ownerUUID, err := pgstore.ParseUUID(ref.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	memberUUID, err := pgstore.ParseUUID(ref.MemberID)
	if err != nil {
		return fmt.Errorf("parse member id: %w", err)
	}
	if uerr := db.New(r.pool).UpsertAppState(ctx, db.UpsertAppStateParams{
		OwnerID: ownerUUID, MemberID: memberUUID, McpID: ref.McpID, StateKey: ref.Key, Value: value,
	}); uerr != nil {
		return fmt.Errorf("upsert app state: %w", uerr)
	}
	return nil
}

// Get — reads the whole (member, mcp) cell, returning key → opaque value. An empty cell
// returns an empty map.
func (r *AppStateRepo) Get(
	ctx context.Context, memberID, mcpID string,
) (map[string]json.RawMessage, error) {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return nil, fmt.Errorf("parse member id: %w", err)
	}
	rows, qerr := db.New(r.pool).GetAppStateByMCP(ctx, db.GetAppStateByMCPParams{
		MemberID: memberUUID, McpID: mcpID,
	})
	if qerr != nil {
		return nil, fmt.Errorf("get app state: %w", qerr)
	}
	out := make(map[string]json.RawMessage, len(rows))
	for i := range rows {
		out[rows[i].StateKey] = rows[i].Value
	}
	return out, nil
}

// Delete — deletes one (member, mcp, key). Not found is not an error (idempotent).
func (r *AppStateRepo) Delete(
	ctx context.Context, memberID, mcpID, key string,
) error {
	memberUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return fmt.Errorf("parse member id: %w", err)
	}
	if derr := db.New(r.pool).DeleteAppState(ctx, db.DeleteAppStateParams{
		MemberID: memberUUID, McpID: mcpID, StateKey: key,
	}); derr != nil {
		return fmt.Errorf("delete app state: %w", derr)
	}
	return nil
}
