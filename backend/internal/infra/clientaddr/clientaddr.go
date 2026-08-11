// Package clientaddr —— 判定「这个请求的来源地址是不是访客自己的」，并且只判定一次。
//
// chi.RealIP 会把 X-Forwarded-For / X-Real-IP 解到 RemoteAddr 上。没有那类头时，
// RemoteAddr 停在**上一跳**——而自托管的出厂形态恰恰是
//
//	浏览器 → app（Next 的 /api/:path* rewrite）→ backend
//
// 中间没有人写转发头（`make prod-up` 写着 "TLS/domain is external"，反代是 owner
// 自带的）。于是每一个访客都被记成同一个地址：app 容器自己。
//
// 那个地址被当真会出三件事，都不是难看而已：
//   - owner 的 /admin/conversations 有一栏叫 IP，而 /admin/ip-bans 教他
//     "Find offending IPs in conversations" —— 照做就是封掉全部访客；
//   - per-IP 的访问码失败锁定变成一个**全局桶**：一个人打错 10 次，15 分钟内
//     所有人（包括拿着真码来面试的）都进不来；
//   - owner 自己的登录限流同样共用那一个桶。
//
// 所以这里的规矩是：**要么是访客的地址，要么就是不知道。** 拿不准时返回空串，
// 让下游按「未知」处理（conversations.client_ip 的契约本来就是「空 = 未知」），
// 绝不拿中间那一跳冒充访客。
//
// 判不出来的那一次会 WARN 一条（每进程一次），把后果和解法都写在日志里 —— 这个
// 分叉以前没有任何地方说过，而运维只会在日志里找部署的真相。
package clientaddr

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
)

type ctxKey struct{}

// forwardHeaders —— chi.RealIP 认的那几个头。**有没有**这些头决定 RemoteAddr 是
// 访客的地址还是上一跳的地址；这里只看有无，值的解析仍然归 RealIP。
var forwardHeaders = []string{"X-Forwarded-For", "X-Real-IP", "True-Client-IP"}

// Middleware —— 排在 chi.RealIP 之后：判一次「来源地址是不是访客的」，把结论放进
// context。结论只在这里产生，读的人（会话记账 / 访问码锁 / 登录限流）拿的是同一个答案。
func Middleware(log *slog.Logger) func(http.Handler) http.Handler {
	var once sync.Once
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			v := resolve(r)
			if v.worthWarning() {
				once.Do(func() { warnHidden(log, v.peer) })
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, v.addr)))
		})
	}
}

// Of —— 读结论。空串 = 不知道（不是 0.0.0.0，也不是上一跳的地址）。
// 没经过 Middleware 的请求（单测里直接构造的）也返回空串：宁可未知，不可冒充。
func Of(ctx context.Context) string {
	addr, ok := ctx.Value(ctxKey{}).(string)
	if !ok {
		return ""
	}
	return addr
}

// verdict —— 一次判定的结果。addr 是访客的地址（空 = 不知道），peer 是这一跳的对端
// （只给日志用，绝不当访客地址）。
type verdict struct {
	addr   string
	peer   string
	hidden bool
}

// worthWarning —— 该不该拿这一次去点名部署分叉。只为**可能是访客**的请求点名：
// 容器自己的健康检查走环回、也没有转发头，它会抢走那条"每进程一次"的警告，然后
// peer 写着 127.0.0.1 —— 内容对、指的对象不对，运维会当成健康检查的噪音划掉。
func (v verdict) worthWarning() bool {
	if !v.hidden {
		return false
	}
	ip := net.ParseIP(hostOf(v.peer))
	return ip == nil || !ip.IsLoopback()
}

// resolve —— 三种情形：
//
//	有转发头        → RealIP 已经解过了，host 就是访客的地址
//	私网/环回的对端 → 没有转发头时那只可能是我自己这一侧的跳，判为不知道
//	其它            → 直连过来的公网客户端
func resolve(r *http.Request) verdict {
	host := hostOf(r.RemoteAddr)
	if forwarded(r) {
		return verdict{addr: host, peer: r.RemoteAddr}
	}
	if isInternalHop(host) {
		return verdict{peer: r.RemoteAddr, hidden: true}
	}
	return verdict{addr: host, peer: r.RemoteAddr}
}

func forwarded(r *http.Request) bool {
	for _, h := range forwardHeaders {
		if r.Header.Get(h) != "" {
			return true
		}
	}
	return false
}

func hostOf(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr // 本来就是裸 IP
	}
	return host
}

// isInternalHop —— 私网 / 环回 / 链路本地。公网访客不可能带着这种源地址到达，
// 所以这类地址加上「没有转发头」只可能是自己这一侧的跳。
func isInternalHop(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return true // 连地址都不是（unix socket 之类）—— 同样不是访客的地址
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// warnHidden —— 每进程一次。说清楚**丢了什么能力**，以及怎么拿回来。
func warnHidden(log *slog.Logger, remoteAddr string) {
	log.Warn("visitor IP not visible: no forwarding header on the proxy hop",
		"peer", remoteAddr,
		"effect", "conversations record no source IP; per-IP code lockout and login "+
			"rate limiting apply to everyone as one bucket; IP bans cannot target a visitor",
		"fix", "front this instance with a proxy that sets X-Forwarded-For")
}
