// face.go —— 面(face)与结构性 parity。
//
// 过去 parity 是一张手写对照表:每个 op 一行,写着"它在 MCP 上该叫什么、在 admin 上该是哪条
// 路由",启动时拿真实的工具名和真实路由去跟表比。那张表存在的唯一理由是**两个面各自手写**、
// 谁也不是谁的投影,于是只能事后人肉对账。
//
// 收口一旦存在,这件事就不该再由任何文件回答。这里的做法是:
//
//   - 面向收口注册自己(Attach),拿到一个 Face;
//   - **取用能力的动作本身就是登记投影的动作** —— 想服务一个 op,只能经 Face 拿到它的 Invoke,
//     拿的同时就被记下了。没有"拿了忘记登记"这条缝;
//   - 生成型的面(MCP)走 Face.Ops(),一次拿全部 → 它的完备性是构造出来的;
//     核对型的面(admin HTTP)照常手写 REST 形状,逐条 Face.Op(id) 取能力 → 取到即登记;
//   - 启动时 Conform():每个 op 的 Reach 声明了它欠哪些面,跟实际登记比。少一个就红。
//
// 于是 parity 是结构的性质,不是维护出来的一致。新增一个面时也成立:面一 Attach,它欠的每一个
// op 立刻被列出来 —— 不需要有人记得去更新什么。

package dispatcher

import (
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// Face —— 一个对外的面在收口这一侧的把手。profile 声明这个面服务读/动作、能承载什么类别
// (浏览器流程 / 明文密钥 / multipart),Reach 据此判断这个面欠不欠某个 op。
type Face struct {
	d       *Dispatcher
	served  map[string]bool
	profile fp.Facade
}

// Attach —— 一个面注册到收口。同名重复注册返回同一个 Face(投影记录累加),
// 这样一个面的路由分散在几个文件里 wire 也没关系。
func (d *Dispatcher) Attach(profile fp.Facade) *Face {
	for _, f := range d.faces {
		if f.profile.Name == profile.Name {
			return f
		}
	}
	f := &Face{d: d, profile: profile, served: map[string]bool{}}
	d.faces = append(d.faces, f)
	return f
}

// Ops —— 生成型的面用它:一次取走全部操作,并登记为全部已投影。MCP 面走这条路,
// 所以"新增一个 op 忘了在 MCP 上注册"这件事在结构上不存在。
func (f *Face) Ops() []Op {
	ops := f.d.Ops()
	for i := range ops {
		f.served[ops[i].ID] = true
	}
	return ops
}

// Op —— 核对型的面用它:按 id 取一个操作(Invoke 已套好装饰器链),取到即登记为已投影。
// admin HTTP 面在 wire 一条路由时用它 —— 路由形状、状态码、参数绑定照常手写,
// 但**能力只能从这儿拿**,于是"这条路由服务了哪个 op"是收口知道的事实,不是注释里的声称。
func (f *Face) Op(id string) (Op, bool) {
	op, ok := f.d.lookup(id)
	if ok {
		f.served[id] = true
	}
	return op, ok
}

// MustOp —— Op 的断言版,给组装期用:id 拼错 = 启动就炸,而不是悄悄少一条路由。
func (f *Face) MustOp(id string) Op {
	op, ok := f.Op(id)
	if !ok {
		panic("dispatcher: face " + f.profile.Name + " wants unknown op " + id)
	}
	return op
}

// Conform —— 全部已注册的面对着各自 Reach 的应尽之责对一遍账。空 = 一致。
//
// 三类违规都由 facadeparity 给出:missing(这个面欠这个 op 却没投影)、
// orphan(投影了一个收口不认识的东西)、leak(owner 面上出现 outward 的 op,反之亦然)。
func (d *Dispatcher) Conform() []fp.Violation {
	exposures := make([]fp.Exposure, 0, len(d.faces))
	for _, f := range d.faces {
		exposures = append(exposures, fp.Exposure{Facade: f.profile, Exposed: f.served})
	}
	return fp.Conform(d.ParityOps(), exposures)
}

// ConformReport —— 人能读的违规报告(空字符串 = 一致)。组装根启动时打印/panic 用。
func (d *Dispatcher) ConformReport() string {
	vs := d.Conform()
	if len(vs) == 0 {
		return ""
	}
	return fp.Report(vs)
}
