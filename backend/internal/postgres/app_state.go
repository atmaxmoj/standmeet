// app_state.go —— mcp_app_state repo。MCP App（ui:// 沙箱卡）的跨刷新状态持久层。
// scope = (member, mcp_id)；mcp_id 由调用方（route）从 tool 派生后传入，repo 不碰
// ACL / 派生，只读写那一格。value 是 app 自定义 jsonb，repo 当 opaque []byte 透传。

package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/mcpdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// AppStateRepo —— mcp_app_state 表 repo。
type AppStateRepo struct {
	pool *Pool
}

// NewAppStateRepo 构造 AppStateRepo。
func NewAppStateRepo(pool *Pool) *AppStateRepo { return &AppStateRepo{pool: pool} }

// Set —— upsert 一格（ref = member × mcp × key）的 value（opaque jsonb）。
func (r *AppStateRepo) Set(ctx context.Context, ref mcpdomain.AppStateRef, value []byte) error {
	ownerUUID, err := parseUUID(ref.OwnerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	memberUUID, err := parseUUID(ref.MemberID)
	if err != nil {
		return fmt.Errorf("parse member id: %w", err)
	}
	if uerr := dbq.New(r.pool).UpsertAppState(ctx, dbq.UpsertAppStateParams{
		OwnerID: ownerUUID, MemberID: memberUUID, McpID: ref.McpID, StateKey: ref.Key, Value: value,
	}); uerr != nil {
		return fmt.Errorf("upsert app state: %w", uerr)
	}
	return nil
}

// Get —— 读 (member, mcp) 整格，返 key → opaque value。空格返空 map。
func (r *AppStateRepo) Get(
	ctx context.Context, memberID, mcpID string,
) (map[string]json.RawMessage, error) {
	memberUUID, err := parseUUID(memberID)
	if err != nil {
		return nil, fmt.Errorf("parse member id: %w", err)
	}
	rows, qerr := dbq.New(r.pool).GetAppStateByMCP(ctx, dbq.GetAppStateByMCPParams{
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

// Delete —— 删一个 (member, mcp, key)。不存在也不报错（幂等）。
func (r *AppStateRepo) Delete(
	ctx context.Context, memberID, mcpID, key string,
) error {
	memberUUID, err := parseUUID(memberID)
	if err != nil {
		return fmt.Errorf("parse member id: %w", err)
	}
	if derr := dbq.New(r.pool).DeleteAppState(ctx, dbq.DeleteAppStateParams{
		MemberID: memberUUID, McpID: mcpID, StateKey: key,
	}); derr != nil {
		return fmt.Errorf("delete app state: %w", derr)
	}
	return nil
}
