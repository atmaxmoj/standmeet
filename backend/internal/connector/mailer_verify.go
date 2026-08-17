// verify.go —— SMTP 连接测试（不发信）。owner 在 admin 填 SMTP 凭据后点 Connect，后端真去
// dial + EHLO + (STARTTLS / 隐式 TLS) + AUTH（填了用户名则做），握手成功 = 连上。失败按类别给
// 友好理由（host/port → connect；TLS 握手 → tls；坏 user/pass → auth），UI 直接展示这些 sentinel。

package connector

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"time"
)

// 连接测试的分类友好错误（直接给 owner 看；文案含 UI 断言关键词 connect/tls/auth）。
var (
	ErrVerifyConnect = errors.New("couldn't connect to the SMTP server — check the host and port")
	ErrVerifyTLS     = errors.New("TLS handshake failed — check the TLS setting matches the server")
	ErrVerifyAuth    = errors.New("SMTP authentication failed — check the username and password")
)

// wrapSentinel —— 「分类 sentinel + 原始错误」的统一包裹格式。整个 connector 包共用：
// 名字原来叫 wrapCategory，但它包的从来不只是品类（装配失败、凭据失败都是同一个形状），
// 而同值的第二个常量只会让下一个人猜该用哪个。
const wrapSentinel = "%w: %w"

// Verify —— 跑一次 SMTP 握手验证配置，不发信。成功 = 凭据能连。
func Verify(ctx context.Context, cfg *Config) (err error) {
	if cfg.Host == "" {
		return fmt.Errorf("%w: missing host", ErrVerifyConnect)
	}
	c, derr := dialSMTP(ctx, cfg)
	if derr != nil {
		return derr
	}
	defer func() {
		if cerr := c.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()
	return handshake(c, cfg)
}

// outboundDialTimeout —— 拨一个中继最多等多久。
//
// **拨不通有两种**：被拒（立刻回 RST）和石沉大海（包被丢掉，一直等到 TCP 自己放弃）。
// 前者以前也没问题；后者以前要等 **75 秒** —— prod 上量到的就是这个数（`dur_ms=75018`），
// 因为明文那条路用的是 `smtp.Dial`，它**不看 ctx、也没有 deadline**。
//
// 75 秒的后果不是「慢一点」：浏览器早超时了，屏幕上显示的是客户端自己那句「够不着你的
// 实例」，顶栏的健康灯翻成 NOT ANSWERING —— 后端其实**已经把话说对了**（"temporarily
// unavailable"），只是没人还在看。**为用户写好的那句话，被时间挤掉了**（F-C-36）。
//
// 10 秒的依据：真中继的 TCP 握手是毫秒级，SMTP 问候也在一秒内；等到 10 秒还没搭上话，
// 再等下去也不会有别的结果，而 owner 还愿意看着屏幕。
const outboundDialTimeout = 10 * time.Second

// dialSMTP —— TLS="tls" → 隐式 TLS 拨号（明文端口上必握手失败）；否则明文拨号。
// 两条路都走 ctx 且都带上限：以前只有隐式 TLS 那条尊重 ctx，明文那条能挂满一分钟。
func dialSMTP(ctx context.Context, cfg *Config) (*smtp.Client, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	dctx, cancel := context.WithTimeout(ctx, outboundDialTimeout)
	defer cancel()
	if cfg.TLS == "tls" {
		return dialImplicitTLS(dctx, addr, cfg.Host)
	}
	return dialPlain(dctx, addr, cfg.Host)
}

// dialPlain —— 明文拨号（之后由 handshake 决定要不要 STARTTLS 升级）。
// 用 net.Dialer.DialContext 而不是 smtp.Dial：后者不接 ctx，拨不通时只能等 OS 的 TCP 超时。
func dialPlain(ctx context.Context, addr, host string) (*smtp.Client, error) {
	conn, derr := (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	if derr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyConnect, derr)
	}
	c, cerr := smtp.NewClient(conn, host)
	if cerr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyConnect, cerr)
	}
	return c, nil
}

// dialImplicitTLS —— 隐式 TLS 拨号（明文端口上必握手失败 → tls 错）。
func dialImplicitTLS(ctx context.Context, addr, host string) (*smtp.Client, error) {
	tlsCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	conn, terr := (&tls.Dialer{Config: tlsCfg}).DialContext(ctx, "tcp", addr)
	if terr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyTLS, terr)
	}
	c, cerr := smtp.NewClient(conn, host)
	if cerr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyTLS, cerr)
	}
	return c, nil
}

func handshake(c *smtp.Client, cfg *Config) error {
	if herr := c.Hello("localhost"); herr != nil {
		return fmt.Errorf(wrapSentinel, ErrVerifyConnect, herr)
	}
	if terr := maybeStartTLS(c, cfg); terr != nil {
		return terr
	}
	return maybeAuth(c, cfg)
}

// maybeStartTLS —— 非 "none"/"tls" 模式下，服务端宣告 STARTTLS 则升级（opportunistic）。
func maybeStartTLS(c *smtp.Client, cfg *Config) error {
	if cfg.TLS == "none" || cfg.TLS == "tls" {
		return nil
	}
	if ok, _ := c.Extension("STARTTLS"); !ok {
		return nil
	}
	tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	if serr := c.StartTLS(tlsCfg); serr != nil {
		return fmt.Errorf(wrapSentinel, ErrVerifyTLS, serr)
	}
	return nil
}

func maybeAuth(c *smtp.Client, cfg *Config) error {
	if cfg.Username == "" {
		return nil
	}
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	if aerr := c.Auth(auth); aerr != nil {
		return fmt.Errorf(wrapSentinel, ErrVerifyAuth, aerr)
	}
	return nil
}
