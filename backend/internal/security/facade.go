// Package security —— 请求级**防护**域(跟 access 的"认证"分开:认证判"你是谁、能进吗";
// 防护判"这个来源该不该被挡")。
//
// 本文件是 security 的**对外 facade**:薄壳,只把内部子包的类型/构造抬到域根 + codedoc。
// 一眼看全协议,别的层只 import "internal/security"、只用这里的符号。内部实现藏在
// internal/security/internal/{ban,captcha},Go 的 internal/ 可见性**编译期**挡住外部直接引用。
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
// 新增防护能力(如防重放):实现落 internal/ 子包,协议在此加一行转发 + codedoc。
package security

import (
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/security/internal/ban"
)

// ── IP 封禁(实现:internal/ban)────────────────────────────────

// BannedIP —— owner 封掉的一个来源 IP;Active() 判此刻是否生效。
type BannedIP = ban.BannedIP

// BannedIPRepo —— banned_ips 表 repo(Ban/List/Unban/IsBanned/IsBannedAnywhere)。
type BannedIPRepo = ban.BannedIPRepo

// BanIPInput —— Ban 的入参。
type BanIPInput = ban.IPInput

// NewBannedIPRepo —— 构造 banned_ips repo。
func NewBannedIPRepo(pool *pgstore.Pool) *BannedIPRepo { return ban.NewBannedIPRepo(pool) }
