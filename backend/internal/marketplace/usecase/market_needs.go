// market_needs.go —— 市场卡上那句「还需要哪个连接器」怎么算出来的（F-F-4）。
//
// 真值是推导出来的，链条三段：技能声明它要用哪些**工具**（SKILL.md 的 `allowed-tools`）→
// 提供那些工具的**能力**要哪些连接器（manifest 的 `requires`）→ 这个 owner 连了没有。
// 三段没有一段在这个域里，所以这里只声明一个端口，组装根去答。

package usecase

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

// ConnectorNeeds —— 端口：一个技能声明要用这些工具，那它背后要哪些连接器、这个 owner 还
// 缺哪几个。
//
// 为什么答的是「还缺哪几个」而不是「要哪几个」：这两半以前是分开发出去的 —— 服务端发要求
// （从来没发过），客户端自己拿连接器列表做差集，还顺手把 category 手工映成 'Calendar' /
// 'Email' 第三种叫法。同一个问题的两半在两台机器上，注定要漂。
type ConnectorNeeds interface {
	// DepsForTools —— 这些工具背后的连接器名。纯内存。
	DepsForTools(tools []string) []string
	// Unconnected —— 这些连接器里,这个 owner 还没连的那些。
	Unconnected(ctx context.Context, ownerID string, deps []string) ([]string, error)
}

// fillNeeds —— 给这一页里**读过正文**的结果填上「还缺哪几个连接器」。
//
// 一次问完:整页的连接器名先并成一份,只问一次「哪些没连」,再分给各条结果。逐条问的话,
// 一页 12 张卡就是 12 轮同样的检查。
//
// 答不上来时(没接端口 / 没有 owner 上下文 / 检查出错)**什么都不填**:Needs 留 nil = 未知。
// 填成空列表就是把「不知道」说成「不缺」,而那正是这个字段以前的样子。
func fillNeeds(
	ctx context.Context, port ConnectorNeeds, ownerID string, page []entity.MarketSkill,
) {
	if port == nil || ownerID == "" {
		return
	}
	missing, err := unconnectedForPage(ctx, port, ownerID, page)
	if err != nil {
		slog.Default().Warn("marketplace: cannot resolve connector needs", "err", err)
		return
	}
	assignNeeds(port, missing, page)
}

// assignNeeds —— 把整页那份「还没连的」按各条结果自己要的连接器切开。
// 没读过正文的那些跳过 —— 它们的答案是「不知道」,而 nil 就是那个答案。
func assignNeeds(port ConnectorNeeds, missing []string, page []entity.MarketSkill) {
	for i := range page {
		if page[i].AllowedTools == nil {
			continue
		}
		page[i].Needs = intersect(missing, port.DepsForTools(page[i].AllowedTools))
	}
}

// unconnectedForPage —— 整页要用到的连接器里,这个 owner 还没连的那些。
func unconnectedForPage(
	ctx context.Context, port ConnectorNeeds, ownerID string, page []entity.MarketSkill,
) ([]string, error) {
	all := pageDeps(port, page)
	missing, err := port.Unconnected(ctx, ownerID, all)
	if err != nil {
		return nil, fmt.Errorf("unconnected deps: %w", err)
	}
	return missing, nil
}

// pageDeps —— 这一页(读过正文的那些)一共要用到哪些连接器,去重。
func pageDeps(port ConnectorNeeds, page []entity.MarketSkill) []string {
	seen := map[string]struct{}{}
	all := []string{}
	for i := range page {
		if page[i].AllowedTools == nil {
			continue
		}
		all = appendNew(all, seen, port.DepsForTools(page[i].AllowedTools))
	}
	return all
}

func appendNew(out []string, seen map[string]struct{}, more []string) []string {
	for _, v := range more {
		if _, dup := seen[v]; dup {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// intersect —— want 里出现在 missing 中的那些,顺序按 want。恒返非 nil:走到这里就说明
// 这条结果的正文读过了,所以「不缺」是个答案,不是「不知道」。
func intersect(missing, want []string) []string {
	lack := make(map[string]struct{}, len(missing))
	for _, m := range missing {
		lack[m] = struct{}{}
	}
	out := []string{}
	for _, w := range want {
		if _, hit := lack[w]; hit {
			out = append(out, w)
		}
	}
	return out
}
