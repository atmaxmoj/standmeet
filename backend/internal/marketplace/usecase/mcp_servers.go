// mcp_servers.go —— owner 注册的外部 MCP server CRUD。auth header value
// 落 cryptobox 加密 (跟 BYOAI key 同套模式)。InviteCode 选中后 visitor chat
// 拉这一组 server 的 tools 加进 ToolSpec 列表。

package usecase

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/repo"
)

// MCPServersDeps —— mcp servers CRUD + per-code 关联用的 repo 集合。
//
// Prober 是**端口不是仓储**：域声明「去问一句」，出站那一侧实现它（见下）。
type MCPServersDeps struct {
	Servers *repo.MCPServerRepo
	Codes   *access.CodeRepo
	Prober  MCPServerProber
}

// MCPServerProber —— 问一台已注册的 server：**它答不答话、都有哪些工具**（F-D-8）。
//
// 为什么是端口：那台 server 的认证头在库里是密文，而**这一侧从不解封**（跟 ext-mcp 装配
// 同一条规矩 —— 拿到的应该是「能直接拨的东西」，不是「打开它的钥匙」）。实现落在组装根：
// 那里既有开封器（`cmd/server/unseal.go` 的 dialableMCPServers），也有拨号和列表
// （`mcpclient.Dial` + `ListTools`）—— 装配会话时走的就是那条路，这里只是让 owner
// **主动问一次**，跟连接器那颗只读探针（F-C-16）是同一个形状。
//
// 没接实现（nil）时 `mcp_server_check` 会明说这台实例没有这个能力，而不是假装探过。
type MCPServerProber interface {
	Probe(ctx context.Context, ownerID, serverID string) (MCPProbeResult, error)
}

// MCPProbeResult —— 探针带回来的东西。工具名而不是数量：owner 要认出那一台是不是他想挂的
// 那一台，「3 个工具」认不出来，`ext_deepwiki_ask` 认得出来。
type MCPProbeResult struct {
	Tools []string
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
) (entity.MCPServerConfig, error) {
	if verr := validateMCPCreateInput(in); verr != nil {
		return entity.MCPServerConfig{}, verr
	}
	enc, eerr := encryptAuthValue(in.AuthHeaderValue, []byte(in.OwnerID))
	if eerr != nil {
		return entity.MCPServerConfig{}, eerr
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
) (entity.MCPServerConfig, error) {
	cfg, err := deps.Servers.Create(ctx, &repo.CreateMCPServerInput{
		OwnerID: in.OwnerID, Name: in.Name, URL: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValueEnc: enc,
	})
	if err != nil {
		if errors.Is(err, entity.ErrMCPServerNameTaken) {
			return entity.MCPServerConfig{}, entity.ErrMCPServerNameTaken
		}
		return entity.MCPServerConfig{}, fmt.Errorf("create mcp server: %w", err)
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
) ([]entity.MCPServerConfig, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Servers.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list mcp servers: %w", err)
	}
	return rows, nil
}

// CheckMCPServer —— 去问那台 server 一句：答不答话、有哪些工具（F-D-8）。
//
// 先确认这台 server 真属于这个 owner（repo 那一层管归属），再让端口去拨。**读操作**：
// 它不写任何东西，也不改这台 server 的状态 —— owner 想知道的只是「我刚粘的这个 URL 对不对」。
func CheckMCPServer(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID string,
) (MCPProbeResult, error) {
	if err := checkProbePrereqs(ctx, deps, ownerID, serverID); err != nil {
		return MCPProbeResult{}, err
	}
	res, perr := deps.Prober.Probe(ctx, ownerID, serverID)
	if perr != nil {
		return MCPProbeResult{}, fmt.Errorf("probe mcp server: %w", perr)
	}
	return res, nil
}

// checkProbePrereqs —— 拨号之前要成立的三件事:参数齐、这台实例有探针、这台 server 归他。
func checkProbePrereqs(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID string,
) error {
	if ownerID == "" || serverID == "" {
		return apierr.ErrEmptyField
	}
	if deps.Prober == nil {
		return ErrMCPProbeUnavailable
	}
	if _, err := deps.Servers.GetByID(ctx, ownerID, serverID); err != nil {
		return fmt.Errorf("get mcp server: %w", err)
	}
	return nil
}

// ErrMCPProbeUnavailable —— 这台实例没接探针实现。**说出来**，别报成「那台 server 不答话」：
// 那两件事对 owner 的意思完全相反（同 F-C-23 分开的那两句话）。
var ErrMCPProbeUnavailable = errors.New("this instance cannot probe MCP servers")

// 探针失败的两类，**owner 要做的事完全不同**（F-D-15）：一个去改 token，一个去改 URL。
// 它们曾经是同一句「no answer — internal error」——「答了话但拒绝」被说成了「拨不通」。
//
// 为什么哨兵在域里而不是直接认传输层的错：`mcpclient` 是出站实现，本域只声明端口
// （`MCPServerProber`）；组装根拨完号，把传输层的真相翻成这两个词交回来。
var (
	// ErrMCPServerRefusedAuth —— 对面答了话，只是不收这份凭据。
	ErrMCPServerRefusedAuth = errors.New("mcp server refused the auth header")
	// ErrMCPServerNoAnswer —— 真的够不着（网络 / URL / 协议）。
	ErrMCPServerNoAnswer = errors.New("mcp server did not answer")
)

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
