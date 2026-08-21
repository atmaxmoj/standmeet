// capreg_mcp_app_allowance.go —— 用量到顶的那一场，这个能力对模型说什么。
//
// F-B-14（prod 上真出过）：额度用尽时宿主把这个能力**整个藏起来**，而它的说明书从不问闸 ——
// 于是那一轮的 agent 读到「你会订会」，手上却没有那把工具，**也没有一句话说明发生了什么**。
// 「从来没有这把工具」和「额度用完了」是同一份证据，而模型对这份证据最自然的修复，是怀疑
// 自己刚才的输出：它当着访客的面，把两场**真的**会说成「其实没订成、邀请也没发过」——
// 而那两场会好好地在 owner 的日历上。
//
// 藏工具是对的（别让模型看见一把用不了的工具）；**沉默不是回答**。同一件事今天在 HTTP 那一面
// 修过一次：额度用尽回 429 `quota_exhausted` 而不是「你从来没这个能力」（F-B-11）。会话这一面
// 还多欠一半 —— API 调用方不需要，访客需要：**已经做成的那些算数**。
//
// 宿主不认识 booking：这句话用能力自己的 Title 说，换个能力照样成立。

package capload

import (
	"context"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// SessionNote —— capreg.SessionNoter：这一场里这个能力非说不可的那句话。
//
// 走这条路而不是只改说明书，是因为**访客那份 system prompt 在会话开始时就冻住了**（客户端
// 拼好再发回来）。会话中途才成立的事实只能经每一轮的 instruction 进去 —— 那正是这个接口存在
// 的理由，也是 F-B-14 里那句话原来根本到不了模型手上的原因。
func (c *mcpAppCapability) SessionNote(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	return c.spentAllowanceNote(ctx, in)
}

// spentAllowanceNote —— 用量到顶时，**替**这个能力的说明书说的那一句。空 = 没到顶，照常发说明书。
func (c *mcpAppCapability) spentAllowanceNote(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	if !c.quotaSpent(ctx, in) {
		return ""
	}
	return "This visitor has used up their allowance for " + c.allowanceLabel() +
		" on this access code, so that tool is not available for the rest of this session. " +
		"Anything already done with it stands — it really happened and the results are real, " +
		"and you must not suggest otherwise. Say plainly that no more are available on this " +
		"code, and point them at the owner if they need another."
}

// quotaSpent —— 闸是不是因为**用量到顶**把这个能力藏了。没挂闸 / 别的理由 → false。
//
// 问的是同一个闸(同一份计数)，不是另算一遍：两处各算一次的话，说明书说的和工具表做的
// 迟早会不一致，而不一致的那一刻正是这条缺陷发生的时刻。
func (c *mcpAppCapability) quotaSpent(ctx context.Context, in *capreg.AssembleInput) bool {
	if c.gate == nil {
		return false
	}
	ok, err := c.gate(ctx, in)
	return !ok && errors.Is(err, capreg.ErrQuotaExhausted)
}

// allowanceLabel —— 这句话里怎么称呼这个能力。Title 是给人看的名字；没有就退回 id，
// 而不是留一个空洞（"used up their allowance for  on this access code"）。
func (c *mcpAppCapability) allowanceLabel() string {
	if c.m.Title != "" {
		return c.m.Title
	}
	return c.m.ID
}
