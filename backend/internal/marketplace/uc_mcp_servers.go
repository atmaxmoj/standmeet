// mcp_servers.go —— owner 注册的外部 MCP server CRUD。auth header value
// 落 cryptobox 加密 (跟 BYOAI key 同套模式)。InviteCode 选中后 visitor chat
// 拉这一组 server 的 tools 加进 ToolSpec 列表。

package marketplace

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
)

// MCPServersDeps —— mcp servers CRUD + per-code 关联用的 repo 集合。
type MCPServersDeps struct {
	Servers *MCPServerRepo
	Codes   *access.CodeRepo
}

// CreateMCPServerReq —— create 入参。AuthHeaderValue 是明文，本函数
// cryptobox.Encrypt 一次再落库。
type CreateMCPServerReq struct {
	OwnerID         string
	Name            string
	URL             string
	AuthHeaderName  string
	AuthHeaderValue string
}

// CreateMCPServer —— 新建 mcp_server。name 冲突翻 ErrMCPServerNameTaken。
func CreateMCPServer(
	ctx context.Context, deps MCPServersDeps, in *CreateMCPServerReq,
) (MCPServerConfig, error) {
	if verr := validateMCPCreateInput(in); verr != nil {
		return MCPServerConfig{}, verr
	}
	enc, eerr := encryptAuthValue(in.AuthHeaderValue, []byte(in.OwnerID))
	if eerr != nil {
		return MCPServerConfig{}, eerr
	}
	return persistMCPServer(ctx, deps, in, enc)
}

func validateMCPCreateInput(in *CreateMCPServerReq) error {
	if in.OwnerID == "" || in.Name == "" || in.URL == "" {
		return apierr.ErrEmptyField
	}
	return nil
}

func persistMCPServer(
	ctx context.Context, deps MCPServersDeps, in *CreateMCPServerReq, enc []byte,
) (MCPServerConfig, error) {
	cfg, err := deps.Servers.Create(ctx, &CreateMCPServerInput{
		OwnerID: in.OwnerID, Name: in.Name, URL: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValueEnc: enc,
	})
	if err != nil {
		if errors.Is(err, ErrMCPServerNameTaken) {
			return MCPServerConfig{}, ErrMCPServerNameTaken
		}
		return MCPServerConfig{}, fmt.Errorf("create mcp server: %w", err)
	}
	return cfg, nil
}

// aad = owner_id: ext-mcp auth header 密文绑到该 owner；buildAuthHeaders 用 cfg.OwnerID 同串解。
func encryptAuthValue(plaintext string, aad []byte) ([]byte, error) {
	if plaintext == "" {
		// 列是 NOT NULL DEFAULT '\x'::bytea，pgx 接到 nil 会写 NULL 而不
		// 是默认空 bytes；显式给 []byte{} 让落库走 zero-length bytea。
		return []byte{}, nil
	}
	enc, err := cryptobox.Encrypt([]byte(plaintext), aad)
	if err != nil {
		return nil, fmt.Errorf("encrypt auth value: %w", err)
	}
	return enc, nil
}

// ListMCPServers —— admin / MCP list。
func ListMCPServers(
	ctx context.Context, deps MCPServersDeps, ownerID string,
) ([]MCPServerConfig, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Servers.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list mcp servers: %w", err)
	}
	return rows, nil
}

// DeleteMCPServer —— 删除单条；属于 owner 校验经 repo。
func DeleteMCPServer(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID string,
) error {
	if ownerID == "" || serverID == "" {
		return apierr.ErrEmptyField
	}
	if _, gerr := deps.Servers.GetByID(ctx, ownerID, serverID); gerr != nil {
		return fmt.Errorf("get mcp server: %w", gerr)
	}
	if err := deps.Servers.Delete(ctx, ownerID, serverID); err != nil {
		return fmt.Errorf("delete mcp server: %w", err)
	}
	return nil
}

// GrantMCPServerDep —— owner 显式授权这个 ext-mcp server 可接某 connector 依赖（dep 名）。
// ext-mcp 最低信任，工具声明 Requires 默认不注入；grant 写进 server.GrantedDeps，装配期
// 闸（capreg_ext_mcp_deps.go）凭它 + connected 放行。先校验 server 属于 owner。幂等。
func GrantMCPServerDep(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID, dep string,
) error {
	if ownerID == "" || serverID == "" || dep == "" {
		return apierr.ErrEmptyField
	}
	return grantDepOwned(ctx, deps, ownerID, serverID, dep)
}

// grantDepOwned —— 校验 server 属于 owner 后写 grant（幂等）。
func grantDepOwned(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID, dep string,
) error {
	if _, gerr := deps.Servers.GetByID(ctx, ownerID, serverID); gerr != nil {
		return fmt.Errorf("get mcp server: %w", gerr)
	}
	if err := deps.Servers.GrantDep(ctx, ownerID, serverID, dep); err != nil {
		return fmt.Errorf("grant mcp server dep: %w", err)
	}
	return nil
}

// A.3-IAM-5: SetCodeMCPServers / SetCodeMCPServersInput 等都删了 —— mcp servers
// 通过 role_mcp_servers 挂在 Role 上。
