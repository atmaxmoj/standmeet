// visitor_profile.go —— 访客的自述身份(profile)。

package domain

// VisitorProfile —— 访客进入时填 / 带的自述身份。挂在 session(visitor 身份),
// 不挂 chat —— 一个人跨多段对话是同一个 profile。
//
//   - Name  —— owner 在 transcript 里看到的名字(handle 也行)。
//   - Email —— 可选。booker 拿它当 calendar_book 的 visitor_email 兜底
//     (AI 没从对话里问到也能让 Google 发 invite),也是发确认邮件的 default
//     收件地址。空 = 没填。
//
// 访客时区(#120)等将来也归到这个 profile。
type VisitorProfile struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}
