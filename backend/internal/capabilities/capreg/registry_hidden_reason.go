// registry_hidden_reason.go —— 「这个 tool 为什么不在这一场里」。
//
// 藏起来是对的,**不说为什么**才是问题所在,而且只在一个面上是问题:
//
//   - 聊天面:模型看不见那把工具就够了。多说一句反而会让它替访客转述一个它管不着的限制。
//   - HTTP 面:调用方是**点名要**这把工具的程序。「你这把 key 从来没这个能力」和「你的额度
//     用完了」要它做的事完全相反(去找 owner 要权限 / 等一等或加额度),而在此之前两者
//     得到的是同一句 `capability_not_enabled`(F-B-11、[[collapsed-error-class-kills-its-own-branch]])。
//
// 只在**答不上来的时候**才问一次:装配成功的路径一次都不会走到这儿,所以不给热路径加成本。

package capreg

import (
	"context"
	"fmt"
	"slices"
)

// HiddenReasonForTool —— 声明提供这个 tool 的那个能力,这一场是因为什么没出现。
//
// 返回 nil 表示「没有可说的理由」:没有能力声明这个名字、或者它其实好好地在场。调用方据此
// 回落到原来那句通用的拒绝 —— **不许把 nil 读成「一切正常」**。
//
// 只问**说得出自己 tool 名**的能力(ToolNameKnower)。说不出的要拨号才知道,而这里是一条
// 已经失败的请求,再为它冷启一排沙箱是拿慢换一句话([[send_confirmation 19s]] 那一族)。
func (r *Registry) HiddenReasonForTool(
	ctx context.Context, in *AssembleInput, tool string,
) error {
	for _, c := range r.enabledCaps(ctx, in) {
		names, known := knownToolNames(c)
		if !known || !slices.Contains(names, tool) {
			continue
		}
		if err := bindingReason(ctx, c, in); err != nil {
			return err
		}
	}
	return nil
}

// bindingReason —— 这个能力这一场装不装得起来。装得起来 → 关掉它、返 nil(问的人要的是
// 「为什么没有」,而它明明有)。
func bindingReason(ctx context.Context, c Capability, in *AssembleInput) error {
	b, err := c.VisitorBinding(ctx, in)
	if err != nil {
		// 包一层带上是谁,但**保住哨兵**:问的人靠 errors.Is 认那个理由。
		return fmt.Errorf("capability %q hidden: %w", c.ID(), err)
	}
	closeBinding(b)
	return nil
}
