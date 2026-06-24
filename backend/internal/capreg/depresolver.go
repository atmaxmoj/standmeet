// depresolver.go —— host 命名依赖 provider 注册表（connector 重构）。
//
// 设计（docs/design/connector-deps-tests.md）：插件 manifest 声明 `Requires:[...]`
// 命名 in-app 依赖（"calendar" / "smtp" …），每个名字背后是一个 connector。host
// 把这些 provider 注册进本表；`enabledCaps` 解析每个 cap 的 Requires：任一未连 →
// 该 cap 不进 enabledCaps（global 单点闸）→ 对所有 session 一律隐藏（决策点 D-2）。
//
// 凭据永不进本层：provider 只回「连没连」(Connected) 与「调用句柄」(非 token)。
package capreg

import "context"

// DepProvider —— 一个命名 in-app 依赖（"calendar" / "smtp"），背后是一个持凭据的
// connector。host 用它解析插件的 manifest Requires。
type DepProvider interface {
	// Name —— 依赖名，跟 manifest Requires 里的字符串对应。
	Name() string
	// Connected —— 该 owner 是否有一个「可用」连接（已授权 + 已验证）。gate 半边只
	// 看这个；未连 → 依赖它的 cap 隐藏。返 error = 解析失败（E1：当未连处理 + log）。
	Connected(ctx context.Context, ownerID string) (bool, error)
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
		if _, ok := r.providers[n]; !ok {
			out = append(out, n)
		}
	}
	return out
}

// AllConnected —— names 里的依赖**全部**已连才返 true（AND 语义）。任一 provider 未
// 注册 → false（防御）。任一 Connected 返 error → (false, err)（E1：caller 当未连
// 隐藏 + log）。空 names → (true, nil)（无依赖的 cap 不被 gate）。
func (r *DepRegistry) AllConnected(ctx context.Context, ownerID string, names []string) (bool, error) {
	for _, n := range names {
		p, ok := r.providers[n]
		if !ok {
			return false, nil
		}
		connected, err := p.Connected(ctx, ownerID)
		if err != nil {
			return false, err
		}
		if !connected {
			return false, nil
		}
	}
	return true, nil
}
