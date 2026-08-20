// fault.go —— 一次 host op 失败的**类别**，跟着回执一起穿过 socket。
//
// 为什么需要它：沙箱断了网，它对宿主的每一次回头问话都只拿回
// `{"error":"<一句话>"}`。**一句话不是一个类** —— 沙箱那一侧只能把所有失败当成同一种，
// 于是「owner 没配邮件」和「邮件连接器这一刻拨不通」在访客屏幕上说的是同一句话，
// 而其中一句是假的（F-C-42）。
//
// 宿主本来就分得开（`connector` 域有 `errNoActiveConnector` → `ErrMailNotConfigured`）；
// 丢分类的地方是**边界**。所以修在边界上：错误带一个码过去，沙箱按码分岔。
//
// 码是**给沙箱看的稳定词表**，不是给人读的句子 —— 句子照旧在 Error() 里，
// 而且句子随时可以改措辞，不会把沙箱的分支改坏（[[collapsed-error-class-kills-its-own-branch]]）。

package hostop

// 固定词表。加一项之前先问：**沙箱拿它会做出不同的事吗**？
// 只是想说得更细一点，那属于 Error() 里的那句话，不属于这里。
const (
	// FaultNotConfigured —— owner 没有配这件事（没有 active 连接器）。
	// 沙箱据此可以说「这条路还没搭起来」。
	FaultNotConfigured = "not_configured"
	// FaultUnavailable —— 配了，但这一刻做不到（拨不通、被拒、超时）。
	// 沙箱据此该说「现在做不了，稍后再试」，**不能**说成没配过。
	FaultUnavailable = "unavailable"
)

// FaultError —— 带类别的 host op 错误。
type FaultError struct {
	Err  error
	Code string
}

func (f *FaultError) Error() string { return f.Err.Error() }

func (f *FaultError) Unwrap() error { return f.Err }

// FaultCode —— 传输层按**方法**认它，不按类型认。
// socket 那一层是严格 leaf（`.go-arch-lint.yml` 里 `capsocket: mayDependOn: []`），
// 它连这个包都不许 import；有了这个方法，它只要声明一个同形的本地接口就够了。
func (f *FaultError) FaultCode() string { return f.Code }
