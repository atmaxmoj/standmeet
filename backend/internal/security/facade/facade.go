// Package security —— 请求级**防护**域(跟 access 的"认证"分开:认证判"你是谁、能进吗";
// 防护判"这个来源该不该被挡")。
//
// 本包(internal/security/facade)是 security 的**对外 facade**:薄壳,只把内部子包的
// 类型/构造抬上来 + codedoc。一眼看全协议,别的层只 import 这个 facade 包、只用这里的符号。
// 内部实现是同域兄弟子包 internal/security/{ban,captcha},由 check-domain-facade-boundary
// 挡住外部直接引用(域外只能 import .../security/facade)。
//
// # 对外协议
//
// IP 封禁(owner 封来源 IP,公开面命中即 403):
//   - NewBannedIPRepo(pool) *BannedIPRepo —— 构造 repo
//   - (*BannedIPRepo) Ban / List / Unban / IsBanned / IsBannedAnywhere
//   - BannedIP(一条封禁,Active() 判此刻是否生效) · BanIPInput(Ban 入参)
//
// captcha 人机校验(登录/发码前;Cloudflare Turnstile 或 noop=关闭):
//   - NewFromConfig(cfg, httpClient) Verifier —— 按 cfg 装配校验器
//   - Verifier.Verify(ctx, token, remoteIP) error —— nil=放行, error=拒绝
//   - Config / Provider(ProviderNone|ProviderTurnstile) · FromEnvLike(siteKey, secret) Config
//   - ErrCaptchaFailed —— 校验失败 sentinel
//
// 新增防护能力(如防重放):实现落同域子包,协议在此加一行转发 + codedoc。
package security

import (
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/security/ban"
)

// ── IP 封禁(实现:ban 子包)────────────────────────────────

// BannedIP —— owner 封掉的一个来源 IP;Active() 判此刻是否生效。
type BannedIP = ban.BannedIP

// BannedIPRepo —— banned_ips 表 repo(Ban/List/Unban/IsBanned/IsBannedAnywhere)。
type BannedIPRepo = ban.BannedIPRepo

// BanIPInput —— Ban 的入参。
type BanIPInput = ban.IPInput

// NewBannedIPRepo —— 构造 banned_ips repo。
func NewBannedIPRepo(pool *pgstore.Pool) *BannedIPRepo { return ban.NewBannedIPRepo(pool) }
