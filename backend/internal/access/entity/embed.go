package entity

import (
	"errors"
	"strings"
	"time"
)

// Embed —— 一个 embed widget 配置。**embed 指向 code**：它是包着某张码的对外配置,
// 引用它暴露的那张码,再在外面加来源限制。owner 在 Access 下管理它,拿到 copy-paste 片段
// 贴到别人网站上（embed 规划 2026-09-01）。
type Embed struct {
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ID             string
	OwnerID        string
	CodeID         string
	Label          string
	KeyID          string
	PublicKey      string
	AllowedOrigins []string
}

// EmbedCreated —— 建一个 embed 的结果：embed 本体 + **只在这一次返回**的私钥 PEM。
// 私钥进 widget 的 JS（不是 code）；服务端只留公钥。
type EmbedCreated struct {
	PrivateKey string
	Embed      Embed
}

// EmbedAuth —— 按 JWT 的 kid 反查到的一组：验签公钥 + 来源白名单 + 它暴露的码。
// session 签发时 code 明文只在这一步、服务端拿到。
type EmbedAuth struct {
	PublicKey      string
	Code           string
	AllowedOrigins []string
}

// OriginAllowed —— EmbedAuth 侧的同名判断（跟 Embed.OriginAllowed 同一套规则）。
func (a *EmbedAuth) OriginAllowed(origin string) bool {
	e := Embed{AllowedOrigins: a.AllowedOrigins}
	return e.OriginAllowed(origin)
}

// ErrEmbedNotFound —— embed 本子里没有这一条（id 不对、或不属于这个 owner）。
var ErrEmbedNotFound = errors.New("embed not found")

// ErrEmbedOriginNotAllowed —— 这张 embed 码不许在这个来源站上用（403）。
var ErrEmbedOriginNotAllowed = errors.New("embed origin not allowed")

// ErrCodeAlreadyEmbedded —— 这张码已经被一个 embed 暴露了（code_id 唯一）。一张码只能有一份
// 来源白名单 —— 再挂一个 embed 就会有第二份白名单，而哪份生效是未定义的。想要第二份，发第二张码。
var ErrCodeAlreadyEmbedded = errors.New("code already exposed by an embed")

// ErrPeriodLimitReached —— 这张码这个周期的额度用完了（403，可再生）。
var ErrPeriodLimitReached = errors.New("period limit reached")

// ErrEmbedTokenInvalid —— embed 的 JWT 凭据没通过（签名坏 / 过期 / 重放 / alg 不对 / kid 不存在
// / origin 与头不一致）。一句 sentinel，不细分是哪一步——不给攻击者一个探测预言机（401）。
var ErrEmbedTokenInvalid = errors.New("embed token invalid")

// OriginAllowed —— 一个来源能不能用这个 embed。
//
//   - AllowedOrigins 空 = 不限,任何来源都放行（今天的行为）。
//   - 非空 = origin 必须精确命中表里某一条。空 origin（没带 Origin 头）在受限时一律拒:
//     一个受限的 embed,连来源都报不出的请求没有理由放行。
//
// 精确匹配（scheme+host+port 全等），不做子域/通配 —— embed 的来源集是 owner 明确列的,
// 通配会把"我只想给 alice.example"悄悄放宽成"给所有 *.example"。
func (e *Embed) OriginAllowed(origin string) bool {
	if len(e.AllowedOrigins) == 0 {
		return true
	}
	got := strings.TrimRight(strings.TrimSpace(origin), "/")
	if got == "" {
		return false
	}
	for _, a := range e.AllowedOrigins {
		if strings.TrimRight(strings.TrimSpace(a), "/") == got {
			return true
		}
	}
	return false
}
