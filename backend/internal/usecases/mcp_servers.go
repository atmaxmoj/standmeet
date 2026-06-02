// mcp_servers.go —— owner 注册的外部 MCP server CRUD。auth header value
// 落 cryptobox 加密 (跟 BYOAI key 同套模式)。InviteCode 选中后 visitor chat
// 拉这一组 server 的 tools 加进 ToolSpec 列表。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// MCPServersDeps —— mcp servers CRUD + per-code 关联用的 repo 集合。
type MCPServersDeps struct {
	Servers *postgres.MCPServerRepo
	Codes   *postgres.CodeRepo
}

// CreateMCPServerInput —— create 入参。AuthHeaderValue 是明文，本函数
// cryptobox.Encrypt 一次再落库。
type CreateMCPServerInput struct {
	OwnerID         string
	Name            string
	URL             string
	AuthHeaderName  string
	AuthHeaderValue string
}

// CreateMCPServer —— 新建 mcp_server。name 冲突翻 ErrMCPServerNameTaken。
func CreateMCPServer(
	ctx context.Context, deps MCPServersDeps, in *CreateMCPServerInput,
) (domain.MCPServerConfig, error) {
	if verr := validateMCPCreateInput(in); verr != nil {
		return domain.MCPServerConfig{}, verr
	}
	enc, eerr := encryptAuthValue(in.AuthHeaderValue)
	if eerr != nil {
		return domain.MCPServerConfig{}, eerr
	}
	return persistMCPServer(ctx, deps, in, enc)
}

func validateMCPCreateInput(in *CreateMCPServerInput) error {
	if in.OwnerID == "" || in.Name == "" || in.URL == "" {
		return ErrEmptyField
	}
	return nil
}

func persistMCPServer(
	ctx context.Context, deps MCPServersDeps, in *CreateMCPServerInput, enc []byte,
) (domain.MCPServerConfig, error) {
	cfg, err := deps.Servers.Create(ctx, &postgres.CreateMCPServerInput{
		OwnerID: in.OwnerID, Name: in.Name, URL: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValueEnc: enc,
	})
	if err != nil {
		if errors.Is(err, domain.ErrMCPServerNameTaken) {
			return domain.MCPServerConfig{}, domain.ErrMCPServerNameTaken
		}
		return domain.MCPServerConfig{}, fmt.Errorf("create mcp server: %w", err)
	}
	return cfg, nil
}

func encryptAuthValue(plaintext string) ([]byte, error) {
	if plaintext == "" {
		// 列是 NOT NULL DEFAULT '\x'::bytea，pgx 接到 nil 会写 NULL 而不
		// 是默认空 bytes；显式给 []byte{} 让落库走 zero-length bytea。
		return []byte{}, nil
	}
	enc, err := cryptobox.Encrypt([]byte(plaintext))
	if err != nil {
		return nil, fmt.Errorf("encrypt auth value: %w", err)
	}
	return enc, nil
}

// ListMCPServers —— admin / MCP list。
func ListMCPServers(
	ctx context.Context, deps MCPServersDeps, ownerID string,
) ([]domain.MCPServerConfig, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
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
		return ErrEmptyField
	}
	if _, gerr := deps.Servers.GetByID(ctx, ownerID, serverID); gerr != nil {
		return fmt.Errorf("get mcp server: %w", gerr)
	}
	if err := deps.Servers.Delete(ctx, ownerID, serverID); err != nil {
		return fmt.Errorf("delete mcp server: %w", err)
	}
	return nil
}

// A.3-IAM-5: SetCodeMCPServers / SetCodeMCPServersInput 等都删了 —— mcp servers
// 通过 role_mcp_servers 挂在 Role 上。
