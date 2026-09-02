// builder.go — Send built on top of fluent compose-and-send. Chain in the fields to write, call
// Send() to send it, so the caller never hand-builds a Message:
//
//	mailer.Compose(cfg).To(addr).Subject(s).Body(b).Send()

package connector

import (
	"context"
	"time"
)

// Builder — a chained constructor for one message being sent.
type Builder struct {
	msg Message
	cfg Config
}

// Compose — start a send builder (cfg = the sender's SMTP config).
func Compose(cfg *Config) *Builder {
	return &Builder{cfg: *cfg}
}

// To — the recipient address.
func (b *Builder) To(addr string) *Builder {
	b.msg.ToAddress = addr
	return b
}

// Subject — the subject line.
func (b *Builder) Subject(s string) *Builder {
	b.msg.Subject = s
	return b
}

// Body — the plain-text body (the fallback for non-HTML clients).
func (b *Builder) Body(s string) *Builder {
	b.msg.Body = s
	return b
}

// HTML — the optional HTML body; when set, sends as multipart/alternative.
func (b *Builder) HTML(s string) *Builder {
	b.msg.HTML = s
	return b
}

// Send — sends it.
// Send — sends it out. **ctx must be carried all the way to the dial**: the caller's deadline
// is how long the owner is still willing to wait, and this dial path used to ignore it
// entirely (F-C-36).
func (b *Builder) Send(ctx context.Context) error {
	return Send(ctx, &b.cfg, &b.msg, time.Now())
}
