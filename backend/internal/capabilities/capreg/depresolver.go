// depresolver.go —— host 命名依赖 provider 注册表（connector 重构）。
//
// 设计（docs/design/connector-deps-tests.md）：插件 manifest 声明 `Requires:[...]`
// 命名 in-app 依赖（"calendar" / "smtp" …），每个名字背后是一个 connector。host
// 把这些 provider 注册进本表；`enabledCaps` 解析每个 cap 的 Requires：任一未连 →
// 该 cap 不进 enabledCaps（global 单点闸）→ 对所有 session 一律隐藏（决策点 D-2）。
//
// 凭据永不进本层：provider 只回「连没连」(Connected) 与「调用句柄」(非 token)。

package capreg

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

// RequiresDeps —— 可选接口：一个 capability 声明它依赖哪些命名 in-app 依赖
// （connector 名，如 "calendar" / "smtp"）。enabledCaps 据此 gate：任一未连 → 该
// cap 不进 enabledCaps（global 单点闸，D-2）。pluginCapability 从 manifest.Requires
// 取；不实现本接口的 cap 永不被 connector-gate。
type RequiresDeps interface {
	Requires() []string
}

// ProvidesVisitorTools —— 可选接口:这个能力在访客侧提供哪些工具**名字**(声明,不是拨号
// 拿到的)。装配之前就要回答「这个工具是谁的」的地方靠它 —— 比如一个 skill 声明
// `allowed-tools: [calendar_book]`,产品要答得出「那需要 calendar 连接器」(F-F-4)。
//
// 跟 RequiresDeps 成对:一个说「我提供哪些工具」,一个说「我要哪些连接器」,合起来才有
// 「这个工具背后要哪个连接器」。不实现本接口的能力(第三方插件默认)在这条路上是**未知**,
// 不是「不需要」—— 调用方必须把这两件事分开。
type ProvidesVisitorTools interface {
	VisitorToolNames() []string
}

// DepsForTools —— 这些工具名背后,一共要哪些命名依赖(连接器名)。纯内存,不碰网络也不碰库。
//
// 只数得出**声明过自己工具名**的能力;没声明的那些在这里是查不到的,而查不到只说明这张表
// 不认识那个工具,不代表那个工具不需要连接器。
func (r *Registry) DepsForTools(tools []string) []string {
	want := make(map[string]struct{}, len(tools))
	for _, t := range tools {
		want[t] = struct{}{}
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, c := range r.List() {
		out = appendDepsIfProvides(out, seen, c, want)
	}
	return out
}

// appendDepsIfProvides —— c 提供了 want 里的任一工具 → 把它的 Requires 并进 out(去重)。
func appendDepsIfProvides(
	out []string, seen map[string]struct{}, c Capability, want map[string]struct{},
) []string {
	return appendNewDeps(out, seen, depsOfProvider(c, want))
}

// depsOfProvider —— c 声明了自己的工具、其中有 want 里的 → 返回它要的连接器;否则空。
func depsOfProvider(c Capability, want map[string]struct{}) []string {
	pv, isProvider := c.(ProvidesVisitorTools)
	rd, hasReqs := c.(RequiresDeps)
	if !isProvider || !hasReqs || !providesAny(pv.VisitorToolNames(), want) {
		return []string{}
	}
	return rd.Requires()
}

func appendNewDeps(out []string, seen map[string]struct{}, more []string) []string {
	for _, dep := range more {
		if _, dup := seen[dep]; dup {
			continue
		}
		seen[dep] = struct{}{}
		out = append(out, dep)
	}
	return out
}

func providesAny(names []string, want map[string]struct{}) bool {
	for _, n := range names {
		if _, hit := want[n]; hit {
			return true
		}
	}
	return false
}

// depsConnected —— 该 cap 的所有 Requires 依赖是否都已连（gate 半边）。判定：
//   - cap 不声明 Requires / 没装 depReg / 无 owner 上下文 → true（不 gate）。
//   - 任一未连 → false（隐藏）。AllConnected 返 error（E1：DB 读错等）→ 当未连隐藏
//   - log（fail-closed：连没连不确定时不暴露能调外部的工具）。
func (r *Registry) depsConnected(ctx context.Context, c Capability, in *AssembleInput) bool {
	rd, ok := c.(RequiresDeps)
	if !ok || len(rd.Requires()) == 0 {
		return true
	}
	return r.requiredDepsConnected(ctx, c, in, rd.Requires())
}

// requiredDepsConnected —— 解析 names 这组依赖：没装 depReg / 无 owner 上下文 → true（不
// gate）；AllConnected 出错（E1）→ false + log（fail-closed）；否则按解析结果。
func (r *Registry) requiredDepsConnected(
	ctx context.Context, c Capability, in *AssembleInput, names []string,
) bool {
	r.mu.RLock()
	dr := r.depReg
	r.mu.RUnlock()
	if dr == nil || in == nil || in.OwnerID == "" {
		return true
	}
	connected, err := dr.AllConnected(ctx, in.OwnerID, names)
	if err != nil {
		slog.Default().Warn("dep resolve failed, hiding capability",
			"capability", c.ID(), "requires", names, "err", err)
		return false
	}
	return connected
}

// DepProvider —— 一个命名 in-app 依赖（"calendar" / "smtp"），背后是一个持凭据的
// connector。host 用它解析插件的 manifest Requires。
type DepProvider interface {
	// Name —— 依赖名，跟 manifest Requires 里的字符串对应。
	Name() string
	// Connected —— 该 owner 是否有一个「可用」连接（已授权 + 已验证）。gate 半边只
	// 看这个；未连 → 依赖它的 cap 隐藏。返 error = 解析失败（E1：当未连处理 + log）。
	Connected(ctx context.Context, ownerID string) (bool, error)
}

// OpProvider —— 除了「连没连」，还答得出**「这个 owner 做不做得了这一个动作」**。
//
// 为什么需要第二个问题（F-B-8 ⭐⭐）：`Connected` 说的是「我们手里有一个可用连接」，
// 那**不等于**「这个连接做得了你要它做的事」。owner 只授了 `calendar.readonly` 时，
// 连接是好的、读也是通的，而写永远 403 —— 产品却照旧把「订会」摆在访客面前，
// 还告诉他「过一会儿再问」（那句话永远不会成真）。
//
// 能力用 `Requires: ["calendar:events.insert"]` 点名它要**哪一个动作**；不带冒号的
// 名字行为跟从前完全一样。内核在这里不认识任何具体品类或 scope —— 它只知道
// 「有的依赖答得出动作级的问题」，答案怎么算是连接器轴那边的事。
type OpProvider interface {
	DepProvider
	// CanPerform —— 这个 owner 现在的授权做不做得了 op（形如 spec 的 operationId）。
	CanPerform(ctx context.Context, ownerID, op string) (bool, error)
}

// splitDep —— `"calendar:events.insert"` → ("calendar", "events.insert")；
// 不带冒号 → (name, "")。
func splitDep(name string) (string, string) { //nolint:revive // dep + op, 顺序在文档注释里
	dep, op, _ := strings.Cut(name, ":")
	return dep, op
}

// NamedProvider —— 把一个 (name, Connected 闭包) 包成 DepProvider。composition root
// 用它把 connector proxy 的 Connected 方法（calendar / smtp）注册成命名依赖，无需让
// connector 包反向 import capreg。凭据从不经此 —— 闭包只回「连没连」。
func NamedProvider(
	name string, connected func(ctx context.Context, ownerID string) (bool, error),
) DepProvider {
	return funcProvider{name: name, connected: connected}
}

type funcProvider struct {
	connected func(context.Context, string) (bool, error)
	name      string
}

func (p funcProvider) Name() string { return p.name }
func (p funcProvider) Connected(ctx context.Context, ownerID string) (bool, error) {
	return p.connected(ctx, ownerID)
}

// NamedOpProvider —— 同 NamedProvider，外加一个「做不做得了这个动作」的闭包。
// 组装根用它把连接器轴那边算好的答案接进来；内核照旧不认识品类和 scope。
func NamedOpProvider(
	name string,
	connected func(ctx context.Context, ownerID string) (bool, error),
	canPerform func(ctx context.Context, ownerID, op string) (bool, error),
) DepProvider {
	return funcOpProvider{
		inner:      funcProvider{name: name, connected: connected},
		canPerform: canPerform,
	}
}

// 组合而不是内嵌：内嵌要排在普通字段之前，而那样排 fieldalignment 又不答应 ——
// 两条闸门在这个结构上互相顶。显式转发一行，比为了迁就排布再加一层豁免干净。
type funcOpProvider struct {
	canPerform func(context.Context, string, string) (bool, error)
	inner      funcProvider
}

func (p funcOpProvider) Name() string { return p.inner.Name() }

func (p funcOpProvider) Connected(ctx context.Context, ownerID string) (bool, error) {
	return p.inner.Connected(ctx, ownerID)
}

func (p funcOpProvider) CanPerform(ctx context.Context, ownerID, op string) (bool, error) {
	return p.canPerform(ctx, ownerID, op)
}

// DepRegistry —— host 持有的命名依赖 provider 注册表。enabledCaps 查它做 gate；
// boot 期用 Unknown 校验 manifest Requires 名字都已知（fail-fast）。
type DepRegistry struct {
	providers map[string]DepProvider
}

// NewDepRegistry —— 空注册表。
func NewDepRegistry() *DepRegistry {
	return &DepRegistry{providers: map[string]DepProvider{}}
}

// Register —— 注册一个命名 provider。重名 panic（boot 期失败比运行时撞名好）。
func (r *DepRegistry) Register(p DepProvider) {
	name := p.Name()
	if _, dup := r.providers[name]; dup {
		panic("capreg: duplicate dep provider " + name)
	}
	r.providers[name] = p
}

// Lookup —— 按名取 provider；未注册 → (nil, false)。
func (r *DepRegistry) Lookup(name string) (DepProvider, bool) {
	p, ok := r.providers[name]
	return p, ok
}

// Unknown —— 返 names 里所有「未注册」的名字（boot 校验：非空 = 拒绝注册该插件）。
func (r *DepRegistry) Unknown(names []string) []string {
	var out []string
	for _, n := range names {
		dep, op := splitDep(n)
		p, ok := r.providers[dep]
		if !ok {
			out = append(out, n)
			continue
		}
		// 点名了动作，而这个 provider 答不出动作级的问题 —— 那也是「不认识」。
		// **在 boot 期拦下**：这种搭配在运行时的表现是「能力静默消失」，
		// 而那跟「owner 没连」长得一模一样，排查时分不出来。
		if _, isOp := p.(OpProvider); op != "" && !isOp {
			out = append(out, n)
		}
	}
	return out
}

// AllConnected —— names 里的依赖**全部**已连才返 true（AND 语义）。任一 provider 未
// 注册 → false（防御）。任一 Connected 返 error → (false, err)（E1：caller 当未连
// 隐藏 + log）。空 names → (true, nil)（无依赖的 cap 不被 gate）。
func (r *DepRegistry) AllConnected(
	ctx context.Context, ownerID string, names []string,
) (bool, error) {
	for _, n := range names {
		// 跟 lacks 走同一条判断 —— 两处各写一遍的话，「带动作的依赖」迟早只在
		// 其中一处生效，而两处都是 gate（一处答是非、一处答名字）。
		missing, err := r.lacks(ctx, ownerID, n)
		if err != nil {
			return false, err
		}
		if missing {
			return false, nil
		}
	}
	return true, nil
}

// Unconnected —— names 里这个 owner **还没连**的那些。
//
// 跟 AllConnected 是同一个问题的两种答案:那个只要一个是非（能不能用），这个要**名字**
// （owner 得知道去连哪一个）。市场卡上那句 "needs X connector" 要的是后者。
//
// 没注册的名字算「缺」:这台实例给不出那个依赖,对 owner 来说跟没连是一回事。
func (r *DepRegistry) Unconnected(
	ctx context.Context, ownerID string, names []string,
) ([]string, error) {
	out := []string{}
	for _, n := range names {
		missing, err := r.lacks(ctx, ownerID, n)
		if err != nil {
			return nil, err
		}
		if missing {
			out = append(out, n)
		}
	}
	return out, nil
}

// lacks —— 这个 owner 缺不缺这一个依赖。
//
// 名字带动作（`calendar:events.insert`）时问的是**做不做得了那个动作**，而不是
// 「连没连」—— 后者对一个只授了只读的连接会说「连着呢」，然后每一次写都 403（F-B-8）。
func (r *DepRegistry) lacks(ctx context.Context, ownerID, name string) (bool, error) {
	dep, op := splitDep(name)
	p, ok := r.providers[dep]
	if !ok {
		return true, nil
	}
	if op != "" {
		return lacksOp(ctx, ownerID, p, dep, op)
	}
	connected, err := p.Connected(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("dep %q connected check: %w", dep, err)
	}
	return !connected, nil
}

// lacksOp —— 动作级的那一问。provider 答不出（没实现 OpProvider）时**当缺**：
// manifest 点名了一个动作，而这台实例的那个依赖回答不了「做不做得了」——
// 那就不该把这个能力放出去。Unknown() 在 boot 期就会把这种搭配拦下来，
// 所以运行时走到这里只会是装配根漏接了闭包。
func lacksOp(
	ctx context.Context, ownerID string, p DepProvider, dep, op string,
) (bool, error) {
	opp, ok := p.(OpProvider)
	if !ok {
		return true, nil
	}
	can, err := opp.CanPerform(ctx, ownerID, op)
	if err != nil {
		return false, fmt.Errorf("dep %q can-perform %q: %w", dep, op, err)
	}
	return !can, nil
}
