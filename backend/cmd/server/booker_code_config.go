// booker_code_config.go —— booker 在一张邀请码上占的那个字段(max_bookings)。
//
// 它是 booker 自己存的 per-code 配额(内核的 access_code 表里没有这一列),但 owner 眼里
// 它就是"这张码"上的一个数字:发码时一起填,列表里一起看。access 域不认识 booker,所以
// 那边只留了一个口子(access.CodeExtras),由这里接上 —— 能力的名字只出现在组装根。
//
// 这是**已知的欠账**的当前形状:真正对的做法是把 per-code 的能力配置做成跟 per-owner 的
// capability config 一样的通用面。在那之前,这个口子至少让 booker 的字段不必长进内核。

package main

import (
	"context"
	"encoding/json"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// bookerCodeExtras —— booker 的 per-code 配额接到 access 的 extras 口上。
type bookerCodeExtras struct{ quota bookerQuotaStore }

//nolint:ireturn // access 那边收的就是这个接口
func newBookerCodeExtras(d *runtimeDeps) access.CodeExtras {
	return bookerCodeExtras{quota: newBookerQuotaStore(d)}
}

// maxBookingsField —— 这个字段在码的入参 schema 里长什么样。
var maxBookingsField = json.RawMessage(
	`{"type":["integer","null"],"description":"Booking cap for this code; null means no limit."}`)

func (bookerCodeExtras) Fields() map[string]json.RawMessage {
	return map[string]json.RawMessage{"max_bookings": maxBookingsField}
}

// Read —— 取不到就不给这个键:另一个能力的存储不该让整张码打不开。
func (b bookerCodeExtras) Read(ctx context.Context, codeID string) map[string]json.RawMessage {
	maxBookings, err := b.quota.MaxBookingsOf(ctx, codeID)
	if err != nil {
		return map[string]json.RawMessage{}
	}
	encoded, merr := json.Marshal(maxBookings)
	if merr != nil {
		return map[string]json.RawMessage{}
	}
	return map[string]json.RawMessage{"max_bookings": encoded}
}

type maxBookingsArgs struct {
	MaxBookings *int32 `json:"max_bookings"`
}

// Write —— 从原始入参里挑自己的字段。没提到就不动;写不进也不挡住发码本身
// (码已经建好了,配额可以再设)。
func (b bookerCodeExtras) Write(ctx context.Context, codeID string, args json.RawMessage) {
	var in maxBookingsArgs
	if err := json.Unmarshal(args, &in); err != nil {
		return
	}
	if in.MaxBookings == nil {
		return
	}
	if err := b.quota.SetMaxBookings(ctx, codeID, in.MaxBookings); err != nil {
		// 另一个能力的存储写不进,不该挡住发码本身:码已经建好了,配额可以再设。
		_ = err
	}
}
