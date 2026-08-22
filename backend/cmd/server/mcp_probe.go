// mcp_probe.go —— owner 主动问一台已注册的外部 MCP server：**你答不答话、都有哪些工具**（F-D-8）。
//
// 为什么实现落在组装根、而不是 marketplace 域里：那台 server 的认证头在库里是密文，
// 而**内侧只封不解**（见 unseal.go 开头那段）。域声明端口（`MCPServerProber`），
// 根这边把两件已经有的东西接起来：
//
//   - `dialableMCPServers`（unseal.go）—— 把「存起来的样子」翻成「能直接拨的样子」；
//   - `mcpclient.Dial` + `ListTools` —— 装配访客会话时走的就是这条路
//     （`internal/routes/capload/capreg_ext_mcp.go:149-163`）。
//
// 所以这颗探针**不是新造的一条出站路**：它是让 owner 手动走一次会话装配已经在走的那条，
// 跟连接器那颗只读探针（F-C-16）同一个形状 —— 一张卡上写着 `connected` 而无从询问，
// 是这个产品犯过的错。
//
// (上面这段跟 package 之间空一行:包注释只有一份,在 doc.go。)

package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// mcpServerProbe —— MCPServerProber 的实现。
type mcpServerProbe struct {
	servers *dialableMCPServers
}

// probeDialTimeout —— 探针的耐心。owner 在等一句话，不该等到浏览器超时；
// 而一台真的在答话的 server 一秒之内就该 initialize 完。
const probeDialTimeout = 12 * time.Second

// Probe —— 拨一次、列一次、挂掉。**不留会话**：这颗探针只回答问题，不建立任何东西。
func (p *mcpServerProbe) Probe(
	ctx context.Context, ownerID, serverID string,
) (marketplace.MCPProbeResult, error) {
	cfg, err := p.servers.GetByID(ctx, ownerID, serverID)
	if err != nil {
		return marketplace.MCPProbeResult{}, err
	}
	dialCtx, cancel := context.WithTimeout(ctx, probeDialTimeout)
	defer cancel()
	sess, derr := mcpclient.Dial(dialCtx, cfg.URL, cfg.AuthHeader.Headers())
	if derr != nil {
		return marketplace.MCPProbeResult{}, dialFailure(derr)
	}
	defer sess.Close()
	tools, terr := sess.ListTools(dialCtx)
	if terr != nil {
		return marketplace.MCPProbeResult{}, fmt.Errorf("list tools: %w", terr)
	}
	names := make([]string, 0, len(tools))
	for i := range tools {
		names = append(names, tools[i].Name)
	}
	return marketplace.MCPProbeResult{Tools: names}, nil
}

// dialFailure —— 把传输层的真相翻成域认得的两个词（F-D-15）。
//
// **翻译在这里，因为拨号也在这里**：域声明端口时说的是「问一句」，它不该认识
// `mcpclient`，更不该认识 mcp-go 的哨兵。真因照旧包在里面进日志。
func dialFailure(err error) error {
	if errors.Is(err, mcpclient.ErrAuthRejected) {
		return fmt.Errorf("%w: %w", marketplace.ErrMCPServerRefusedAuth, err)
	}
	return fmt.Errorf("%w: %w", marketplace.ErrMCPServerNoAnswer, err)
}
