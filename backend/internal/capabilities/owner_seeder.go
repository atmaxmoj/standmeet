// owner_seeder.go —— plugin 声明"我需要 owner 名下存在什么"的那个钩子。
//
// 单独一个文件，不跟 plugin.go 挤：那份已经顶到 revive 的 max-public-structs 上限，
// 而这一条本来就是独立的一件事。

package capabilities

import (
	"context"
	"fmt"
)

// OwnerSeeder —— optional hook: plugin 声明它需要在一个 owner 名下存在的那些 builtin
// （role / prompt / …）。
//
// **必须幂等**：claim 时跑一次，之后每次启动再跑一次（跟 SeedPublicRole 同一个节奏），
// 所以它只能是 upsert。
//
// 为什么归插件而不是归内核的那份 seed：`hiring` 是 job loop 的概念，不是一档内核级
// 访问层。写在 access/entity 里等于让内核认识一个插件的词，而那条 glob
// （招聘官要读的 CV 在哪）也只有插件说得清。
type OwnerSeeder interface {
	SeedOwner(ctx context.Context, ownerID string) error
}

// SeedAllOwners —— 让每个 plugin 把自己那份 builtin 种进这个 owner 名下。
//
// 跟 PeriodicWorker 是同一条教训的第二次：**这个 hook 之前不存在，于是 jobs 插件要的
// 那条 `hiring` role 和 prompt 落进了内核的 roles_seed —— 插件的东西落在装配的地方，
// 只因为 seeder 在那儿。** 内核于是认识了一个插件的词（"招聘"），而
// `check-core-agnostic` 的 CORE_DIRS 不含 access/entity，那道锁结构上看不见这种泄漏。
//
// 宿主只负责"什么时候种"（claim 一次 + 每次启动一次）；种什么、种成什么样，归插件。
func (r *Registry) SeedAllOwners(ctx context.Context, ownerID string) error {
	for _, p := range r.plugins {
		os, ok := p.(OwnerSeeder)
		if !ok {
			continue
		}
		if err := os.SeedOwner(ctx, ownerID); err != nil {
			return fmt.Errorf("seed owner for plugin %s: %w", p.Name(), err)
		}
	}
	return nil
}
