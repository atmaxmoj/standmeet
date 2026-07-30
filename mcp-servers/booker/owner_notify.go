// owner_notify.go —— #130: per-code「约成通知 owner」,re-homed 进沙箱。
//
// 访客约成后,若该 code 开了通知开关,给 **owner 自己** 发一封 owner 视角的邮件
// (区别于 #122 发给访客的确认信)。AI 不参与:booking commit 成功后确定性触发。
//
// 为什么在这儿:#135 把 booker 外置时删掉了 host 侧的 booking_owner_notify.go,提交信息
// 自己记着「owner-notify (#130) not yet re-homed into the sandbox」—— 于是这个特性就这么
// 掉了,两条 e2e 一直红到现在。能力自己的东西归能力:开关本来就存在 booker 自己的 capstore
// (role snapshot 的开关经 `_meta` 递进来),收件人经 owner.meta 取,发信走
// connector.invoke("mail","send") —— 跟确认信同一条路,不需要内核再认识 "booking notify"。
//
// **best-effort**:开关关 / 没配 mail 连接器 / 发信失败,都只是没有通知,绝不让 booking 失败
// (booking 已经落库且日历事件已建,为一封通知信回滚是本末倒置)。

package main

import "encoding/json"

// notifyOwnerOfBooking —— 约成后给 owner 发通知。**异步**:booking 已经成立,不能为一封通知信
// 把 tool 调用挂住(访客盯着卡片等)。发信在后台跑,瞬时传输错按预算重试。
// 永不返回错误:调用点在 booking 成功之后,任何失败都只影响这封信。
func notifyOwnerOfBooking(s session, b *bookingDoc) {
	if !s.NotifyOwner {
		return
	}
	if err := sendOwnerNotify(s, b); err != nil {
		_ = err // best-effort:booking 已成立,通知失败不回滚
	}
}

// sendOwnerNotify —— 组信 + 交给 host 后台投递(带重试)。
func sendOwnerNotify(s session, b *bookingDoc) error {
	to, err := gwOwnerMeta(s.OwnerID, "email")
	if err != nil {
		return err
	}
	if to == "" {
		return nil // owner 没有可投递地址,重试也没用
	}
	ownerTZ, _ := gwOwnerMeta(s.OwnerID, "timezone")
	msg := buildOwnerNotifyEmail(b, s.VisitorName, ownerTZ)
	msg["to"] = to
	payload, merr := json.Marshal(msg)
	if merr != nil {
		return merr
	}
	return gwConnectorInvokeBackground(s.OwnerID, "mail", "send", payload)
}

// buildOwnerNotifyEmail —— owner 视角:谁、什么时候、约了什么。时间按 owner 自己的时区渲染
// (收信的是 owner,不是访客)。
func buildOwnerNotifyEmail(b *bookingDoc, visitorName, ownerTZ string) map[string]string {
	loc := confirmationLocation("", ownerTZ) // 空 visitor tz → 退 owner tz,再退 UTC
	when := b.StartAt.In(loc).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	who := visitorName
	if who == "" {
		who = "A visitor"
	}
	body := "New booking on your calendar:\n\n  " + b.Summary +
		"\n  with " + who + "\n  " + when + "\n"
	// 键名必须跟 contract.MailMessage 的 json tag 一致:body(不是 text)。写错的键会被
	// 静默丢掉 —— 信照发,正文空白,而"发出去了"看起来完全正常。
	return map[string]string{
		"subject": "New booking: " + b.Summary,
		"body":    body,
	}
}
