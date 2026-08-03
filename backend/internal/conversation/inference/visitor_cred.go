// visitor_cred.go —— 访客自带的 provider 凭据(BYOAI)。
//
// **信任级别由类型承载,不由字段承载。** 这个类型的每一份都来自访客,所以它解析出来的
// `Cred` 一定是 Untrusted —— 调用方没有"忘了标"这个选项,因为标不标不归它管。
//
// 之前这里是 `owner.AICredential`:一个住在 owner 域、由 owner facade 导出、同时装
// **owner 自己的 key** 和 **访客的 key** 的结构。两个问题叠在一起:
//
//   - owner 域内部**一个使用者都没有** —— 它住在那儿纯粹是为了被交出去。而 facade 是
//     "域对外的协议",于是"明文 API key 的容器"成了 owner 域协议的一部分:谁 import
//     owner facade 谁白拿,编译器不会问一句为什么。
//   - 两种信任级别共用一个类型,只能靠 `Cred.Untrusted` 这个布尔事后区分。一个布尔的
//     默认值是 false,也就是"可信" —— 一条新的构造路径忘了置它,失败方向是**放行**。
//
// 现在:owner 那份是本包的 unexported `ownerCred`(域内解、域内用,不跨任何门面);
// 访客这份是本类型。两条路各自的信任级别在**构造处**就定死了。

package inference

// VisitorCred —— 访客在 BYOAI 模式下自带的 provider 凭据(路由层从
// X-Byoai-* header 经 HKDF 信封解出)。**永远是不可信的**:Endpoint 由访客控制,
// 所以它的出站要过 SSRF 闸,地址要预校验。
//
// 明文 key 只在一次请求的生命周期里存在;服务端不持久化访客的 key。
type VisitorCred struct {
	Provider string
	Key      string
	Model    string
	Endpoint string
}

// HasKey —— 访客到底带没带 key。没带 → 退回 owner 自己配的 provider。
func (c *VisitorCred) HasKey() bool {
	return c != nil && c.Key != ""
}

// ownerCred —— owner 自己配的 provider 凭据,从 owners 行的密文解出来。
// **不导出**:它一步都不该离开本包 —— 明文凭据跨域走得越远,能看见它的代码就越多。
type ownerCred struct {
	Provider string
	Key      string
	Model    string
	Endpoint string
}
