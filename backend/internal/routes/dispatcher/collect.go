// collect.go —— 收口做的全部事情:import 各域的 facade,把它们声明的操作汇成资源。
//
// 这个文件是"这台实例对外能做的每一件事"的目录页 —— 一个域一行。它不认识任何域的
// 内部结构,只认识各域的正门;操作长什么样、怎么做,是域自己说的。
//
// Deps 由组装根填(它知道哪些 repo 在跑)。收口不构造任何东西。

package dispatcher

import (
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
)

// Deps —— 各域对外声明操作时需要的依赖包,由组装根填。
type Deps struct {
	Corpus         corpus.Deps
	AllowedDomains owner.AllowedDomainsDeps
	BannedIPs      *security.BannedIPRepo
}

// Collect —— 把各域声明的操作汇成资源清单。一个资源一行。
func Collect(d *Deps) []Resource {
	return []Resource{
		{Name: "subjectivity", Ops: corpus.SubjectivityOps(d.Corpus)},
		{Name: "ip_bans", Ops: security.IPBanOps(d.BannedIPs)},
		{Name: "domains", Ops: owner.DomainOps(d.AllowedDomains)},
	}
}
