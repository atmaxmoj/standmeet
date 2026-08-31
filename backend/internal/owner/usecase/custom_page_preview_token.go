// custom_page_preview_token.go —— 预览地址自带的那个凭据。
//
// **为什么不能用 session cookie**：预览跑在一个 `sandbox="allow-scripts"` 的 iframe 里
// （不给 allow-same-origin —— 否则 owner 的 AI 写出来的页面能拿着 owner 的 admin session
// 去做任何事）。而沙箱化的不透明来源，**子资源请求不带 cookie**：文档本身 200，
// 里面那句 `<script src="./assets/index-*.js">` 401，页面一片空白。
// 实测日志：`/preview` → 200 441B，`/preview/assets/index-CQtbe4hQ.js` → 401 70B。
//
// 所以凭据必须走 **URL**。而且必须在**路径**里，不是 query：`<base href>` 上的 query
// 不会被相对路径继承（`./assets/x.js` 解析出来就把它丢了）。
//
// 令牌是**派生的，不是存的**：HMAC(server key, owner|slug|exp)。没有表、没有生命周期、
// 没有"忘了清理"的那一类问题。exp 让一个被复制走的地址不会永久有效。

package usecase

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// PreviewTokenTTL —— 一个预览地址活多久。
//
// 10 分钟：owner 盯着面板看 agent 改页面，是分钟级的事；面板每次重挂 iframe 都会带上
// 一个新令牌，所以对他是无感的。而一个被复制粘贴走的地址十分钟后就打不开了。
const PreviewTokenTTL = 10 * time.Minute

const (
	decimalBase = 10
	bitsInInt64 = 64
)

// ErrPreviewTokenInvalid —— 令牌对不上、过期、或者格式不对。**三种合成一个**：
// 对拿着错令牌的人，区分它们只是在告诉他离对的形状有多远。
var ErrPreviewTokenInvalid = errors.New("preview token invalid")

// NewPreviewToken —— 给这个 owner 的这一页签一个。形如 `<ownerID>.<exp>.<sig>`，
// 都是 URL-safe 的，所以整段可以直接放进路径。
func NewPreviewToken(key, ownerID, slug string, now time.Time) string {
	exp := strconv.FormatInt(now.Add(PreviewTokenTTL).Unix(), decimalBase)
	return fmt.Sprintf("%s.%s.%s",
		base64.RawURLEncoding.EncodeToString([]byte(ownerID)),
		exp,
		previewSig(key, ownerID, slug, exp),
	)
}

// VerifyPreviewToken —— 令牌对得上就返回它属于哪个 owner。
//
// slug 参与签名：一个 slug 的预览令牌换个 slug 用不了 —— 否则拿到任意一页的令牌
// 就等于拿到了所有页。
func VerifyPreviewToken(key, slug, token string, now time.Time) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", ErrPreviewTokenInvalid
	}
	raw, derr := base64.RawURLEncoding.DecodeString(parts[0])
	if derr != nil {
		return "", ErrPreviewTokenInvalid
	}
	ownerID := string(raw)
	if !hmac.Equal([]byte(previewSig(key, ownerID, slug, parts[1])), []byte(parts[2])) {
		return "", ErrPreviewTokenInvalid
	}
	return ownerID, expiredOr(parts[1], now)
}

// expiredOr —— 过期也归 ErrPreviewTokenInvalid：对外只有一种说法。
func expiredOr(exp string, now time.Time) error {
	unix, perr := strconv.ParseInt(exp, decimalBase, bitsInInt64)
	if perr != nil || now.Unix() > unix {
		return ErrPreviewTokenInvalid
	}
	return nil
}

func previewSig(key, ownerID, slug, exp string) string {
	mac := hmac.New(sha256.New, []byte(key))
	// 分隔符必须是不会出现在任一段里的字符，否则 `a|b` + `c` 和 `a` + `b|c`
	// 签出同一个值（[[one-bad-element-voids-the-array]] 的同族问题）。
	// ownerID 是 UUID、slug 是 [a-z0-9-]、exp 是数字，都不含 `\n`。
	// hash.Hash 的 Write 永不返回 error（文档保证）。
	mac.Write([]byte(ownerID + "\n" + slug + "\n" + exp))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
