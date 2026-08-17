// builder.go —— fluent compose-and-send 之上的 Send。把要写的字段链式传入，
// Send() 发出，caller 不用手搓 Message：
//
//	mailer.Compose(cfg).To(addr).Subject(s).Body(b).Send()

package connector

import (
	"context"
	"time"
)

// Builder —— 一封待发信的链式构造器。
type Builder struct {
	msg Message
	cfg Config
}

// Compose —— 起一个发信 builder（cfg = 发件方 SMTP 配置）。
func Compose(cfg *Config) *Builder {
	return &Builder{cfg: *cfg}
}

// To —— 收件人地址。
func (b *Builder) To(addr string) *Builder {
	b.msg.ToAddress = addr
	return b
}

// Subject —— 主题。
func (b *Builder) Subject(s string) *Builder {
	b.msg.Subject = s
	return b
}

// Body —— 纯文本正文(非 HTML 客户端的兜底)。
func (b *Builder) Body(s string) *Builder {
	b.msg.Body = s
	return b
}

// HTML —— 可选的 HTML 正文;设了就发 multipart/alternative。
func (b *Builder) HTML(s string) *Builder {
	b.msg.HTML = s
	return b
}

// Send —— 发出。
// Send —— 发出去。**ctx 要一路传到拨号**：调用方的截止时间就是 owner 还愿意等的时间，
// 而以前这条路上拨号根本不看它（F-C-36）。
func (b *Builder) Send(ctx context.Context) error {
	return Send(ctx, &b.cfg, &b.msg, time.Now())
}
