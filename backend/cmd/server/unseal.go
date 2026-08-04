// unseal.go —— 开封**只在这个文件里发生**。
//
// §1.5:内侧只封,不解。owner 在面板上填一份凭据 → 加密进库 → 内侧从此只见得到密文;
// 要花它的时候,在这里开一次,交出去的是**能用的东西**,不是打开它的钥匙。
//
// 把两处开封摆在一起,是为了让"内侧到底有没有别的口子"变成一眼能数清的事。闸
// (infra/scripts/check-core-seals-only.sh)扫的是 backend/internal;这个文件在
// cmd/ 下,是组装根 —— 它不在内侧,也不该有第三个同类文件。
//
// 交出去的形状讲究一件事:**别交一个能开任意 owner 的函数**。以前 AI 那条就是 ——
// 组装根注一个 cryptobox.Decrypt 闭包进内核,内核自己去开。那不是"内核解了一次密",
// 是内核拿着一把万能钥匙。

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// openAIProviderKey —— 开封 owner 的 AI provider key。
//
// ownerID 作 AAD:密文绑到该 owner,被搬到别的 owner 行时开封 tamper-fail。
// 空密文 = owner 没配,返空串让 resolver 走 ErrOwnerProviderUnconfigured ——
// "没配"跟"开不开"是两件事,不能都报成开封失败。
func openAIProviderKey(ownerID string, enc []byte) (string, error) {
	if len(enc) == 0 {
		return "", nil
	}
	plain, err := cryptobox.Decrypt(enc, []byte(ownerID))
	if err != nil {
		return "", fmt.Errorf("open owner ai key: %w", err)
	}
	return string(plain), nil
}

// mcpServerStore —— 本适配器需要的那一点仓储面。窄到只有一个方法,是为了让
// "这里除了读一行什么都不干"在类型上就成立。
type mcpServerStore interface {
	GetByID(ctx context.Context, ownerID, serverID string) (marketplace.MCPServerConfig, error)
}

// dialableMCPServers —— 把"存起来的样子"翻成"可以去拨的样子":认证头在这里开封。
//
// 装配那一侧(internal/routes/capload)于是永远见不到密文,也不需要会开封 —— 它拿到
// 的 DialableMCPServer 直接就能拨。这跟 AI provider key 是同一条规矩,同一处落地。
type dialableMCPServers struct {
	repo mcpServerStore
}

func (d *dialableMCPServers) GetByID(
	ctx context.Context, ownerID, serverID string,
) (marketplace.DialableMCPServer, error) {
	cfg, err := d.repo.GetByID(ctx, ownerID, serverID)
	if err != nil {
		return marketplace.DialableMCPServer{}, fmt.Errorf("mcp server lookup: %w", err)
	}
	header, herr := openMCPAuthHeader(&cfg)
	if herr != nil {
		return marketplace.DialableMCPServer{}, herr
	}
	return marketplace.DialableMCPServer{
		ID: cfg.ID, OwnerID: cfg.OwnerID, Name: cfg.Name, URL: cfg.URL,
		AuthHeader: header, GrantedDeps: cfg.GrantedDeps,
	}, nil
}

// openMCPAuthHeader —— 开封那台 server 的认证头。没配头 = 这台 server 不要认证,
// 返空 header(不是错):**"不需要认证"跟"开不开"是两件事**,混在一起的话,一台
// 不设防的 server 会被报成凭据故障。
func openMCPAuthHeader(cfg *marketplace.MCPServerConfig) (marketplace.MCPAuthHeader, error) {
	if cfg.AuthHeaderName == "" || len(cfg.AuthHeaderValueEnc) == 0 {
		return marketplace.MCPAuthHeader{}, nil
	}
	plain, err := cryptobox.Decrypt(cfg.AuthHeaderValueEnc, []byte(cfg.OwnerID))
	if err != nil {
		return marketplace.MCPAuthHeader{}, fmt.Errorf("open mcp auth header: %w", err)
	}
	return marketplace.MCPAuthHeader{Name: cfg.AuthHeaderName, Value: string(plain)}, nil
}
