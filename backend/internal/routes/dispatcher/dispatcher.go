// Package dispatcher —— 出站收口:这台实例对外能做的每一件事,在这里声明一次,然后分发到各个面。
//
// # 为什么要多这一层
//
// 之前没有这一层:同一个能力在 admin HTTP 上手写一遍,在 owner MCP 上再手写一遍。两份手写的东西
// 谁也不是谁的投影,于是它们之间的一致性没有任何东西保证 —— 只能靠一张手写对照表
// (internal/infra/paritymanifest,123 行 op)在事后对账,而对账表本身也要人记得维护。这带来三个
// 长期的病:
//
//   - **会漏。** 新增一个能力,admin 加了、MCP 忘了(或反过来),没有任何机制会响。台账能抓,
//     前提是有人记得往台账里加行 —— 而忘了加台账跟忘了加面是同一种忘。
//   - **会飘。** 两个面各自解参、各自校验、各自定载荷形状,同一个能力在两处慢慢长成两个样子
//     (ip_bans 就是:admin 收 reason、MCP 不收;删除一个回 {"ok":true}、另一个回 {"id":...})。
//   - **策略没有唯一施加点。** 鉴权/配额/审计/危险操作确认要挂在每个 endpoint 上,漏一个就是
//     一个洞,而"有没有漏"只能靠人去数。
//
// 收口把这三件事一次性解决:能力只声明一次,面只是它的**投影**。于是 parity 不再是一件要维护的
// 事,而是结构的性质;策略挂在收口上,每个面拿到的能力都已经过完同一条链。
//
// 代价是多一层适配(域的普通函数 → Op)。这层适配本来就存在,只是过去散在每个 handler 里写了
// N 遍 —— 现在它收拢成一处,并且是唯一一处。
//
// # 它不是什么
//
// 它**不是** owner 的东西(跟 owner 域无关),也**不是**第二个 capreg(那是 capability 轴的声明
// 注册表,记"本机 agent 能装载什么")。汇进来的有三类,全都协议无关:
//
//  1. 域操作 —— 各域 facade 出的**普通函数**(CreateRole(ctx,in));域永远不知道自己被 MCP、
//     HTTP、IM 还是 SDK 服务。域 facade 上不该出现 InputSchema / Handler 这类协议词。
//  2. connector 能力 —— connector 轴的 category+verb。
//  3. capreg 能力 —— agent 装载的那些,在对外露出的部分。
//
// 每个面都是它的**投影**:
//
//	dispatcher ──► MCP    (generated:走它长出来,没有手写步骤可忘)
//	           ──► HTTP   (verified:REST 形状手写,但被同一份声明对账)
//	           ──► 将来的 IM / SDK / CLI(加个描述符即可)
//
// 于是 parity 不再是一张要人维护的对照表,而是结构的性质:两个面同源。
//
// 收口自己**不实现任何能力**:它 import 各域的 facade,把各域声明的操作汇起来再导出。
// 声明(id / 说明 / 入参 schema / reach / 实现)属于域,词汇在 internal/infra/facadeparity ——
// 那是域和收口都能 import 的中立包,所以域说得出口,而不必依赖路由。
package dispatcher

import (
	"slices"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// opsPerResourceHint —— 预分配用的每资源操作数估计(list/create/update/delete 这种规模)。
const opsPerResourceHint = 4

// Op / Invoke 的定义在 internal/infra/facadeparity(域要能声明自己会做什么,而域不该
// import 路由)。收口只是再导出它们 —— 见 vocabulary.go。

// Resource —— 按资源分组的一组操作(roles.{list,create,update,delete} 放一起),
// 跟 owner 心里的模型一致,也让读的人一眼看到"这个东西能被怎么摆弄"。
type Resource struct {
	Name string
	Ops  []Op
}

// Decorator —— 包在 Invoke 外面的一层。留给鉴权/配额/审计/危险操作确认这类横切策略。
//
// 为什么位置在这儿:每个面拿能力都只能经收口(HTTP 面照常手写 REST 形状,但 handler 里的
// 能力必须从这里取),于是策略有**唯一的施加点** —— 不会出现"这个 endpoint 忘了加鉴权"。
type Decorator func(op *Op, next Invoke) Invoke

// Dispatcher —— 全部资源的集合 + 施加在每个操作上的装饰器链 + 已注册的面。
//
// 它回答一个问题:**这台实例对外能做的每一件事,是哪一件。** 这个答案在进程里只有一份,
// 所以三件本来要靠人维护的事变成了结构的性质:
//
//	能力只声明一次   → 两个面不会长成两个样子
//	面是它的投影     → 漏一个面会被 Conform 抓到(见 face.go)
//	装饰器挂在它上面 → 策略只有一个施加点,不存在"这个 endpoint 忘了加"
//
// 组装根建**一个**,各个面 Attach 上来。建两个就等于回到两份手写声明,parity 无从谈起。
type Dispatcher struct {
	byID       map[string]int
	resources  []Resource
	ops        []Op
	faces      []*Face
	decorators []Decorator
}

// New —— 用一组资源建收口。id 重复直接 panic:两个操作同名意味着有一个永远取不到,
// 这种事只能在启动时炸掉,不能等到某个面少了一条能力才被发现。
func New(resources ...Resource) *Dispatcher {
	ops, byID := flatten(resources)
	if len(byID) != len(ops) {
		panic("dispatcher: duplicate op id among resources")
	}
	return &Dispatcher{resources: resources, ops: ops, byID: byID}
}

// flatten —— 把按资源分组的操作摊平成一条列表 + id 索引(建一次,之后取用是 O(1))。
func flatten(resources []Resource) ([]Op, map[string]int) {
	ops := make([]Op, 0, len(resources)*opsPerResourceHint)
	byID := make(map[string]int, len(resources)*opsPerResourceHint)
	for i := range resources {
		for j := range resources[i].Ops {
			byID[resources[i].Ops[j].ID] = len(ops)
			ops = append(ops, resources[i].Ops[j])
		}
	}
	return ops, byID
}

// With —— 追加装饰器(按传入顺序自外向内包)。对**所有**操作生效:一个面拿到的每个能力都已经
// 过完这条链,想绕过就得绕过收口 —— 而那条路被结构闸挡死。
func (d *Dispatcher) With(decorators ...Decorator) *Dispatcher {
	d.decorators = append(d.decorators, decorators...)
	return d
}

// Resources —— 全部资源(只读拷贝的浅切片;调用方不该改)。给枚举/工具用。
func (d *Dispatcher) Resources() []Resource {
	if d == nil {
		return []Resource{}
	}
	return d.resources
}

// Ops —— 摊平成操作列表,Invoke 已套好装饰器链。
//
// 面**不该**直接调它:面走 Face(见 face.go),那样取用即登记投影。这里公开是给枚举用
// (结构闸门、测试、以及 Face.Ops 自己)。
func (d *Dispatcher) Ops() []Op {
	if d == nil {
		return []Op{}
	}
	out := make([]Op, 0, len(d.ops))
	for i := range d.ops {
		op := d.ops[i]
		op.Invoke = d.decorate(&op)
		out = append(out, op)
	}
	return out
}

// ParityOps —— 交给 facadeparity 做对账用的形态(只要 id/kind/reach,不带执行入口)。
func (d *Dispatcher) ParityOps() []fp.Op {
	ops := d.Ops()
	out := make([]fp.Op, 0, len(ops))
	for i := range ops {
		out = append(out, fp.Op{ID: ops[i].ID, Kind: ops[i].Kind, Reach: ops[i].Reach})
	}
	return out
}

// lookup —— 按 id 取一个操作,Invoke 已套好装饰器链。**不导出**:面要拿能力必须经 Face.Op,
// 于是"这个面服务了哪个 op"永远是收口记下的事实,没有绕过登记的取用路径。
func (d *Dispatcher) lookup(id string) (Op, bool) {
	i, ok := d.byID[id]
	if !ok {
		return Op{}, false
	}
	op := d.ops[i]
	op.Invoke = d.decorate(&op)
	return op, true
}

// decorate —— 自内向外套上装饰器链(最先注册的在最外层)。
func (d *Dispatcher) decorate(op *Op) Invoke {
	wrapped := op.Invoke
	for _, dec := range slices.Backward(d.decorators) {
		wrapped = dec(op, wrapped)
	}
	return wrapped
}
