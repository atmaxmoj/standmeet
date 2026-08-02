// code_config.go —— 各能力在**邀请码**上占的字段,和照声明执行的用量闸。
//
// 这里替代了三个 booker 专属文件(booker_code_config.go / booker_code_store.go /
// booker_quota.go,共 294 行)。那三个文件里没有一句是 booker 独有的**机制** —— 存一个
// per-code 的值、把它接进发码入参、按它闸一个工具,全是通用的事,只是当时没有通用的地方,
// 所以按 booker 抄了一份。第二个能力想在码上放东西,就得再抄一份。
//
// 现在能力只在自己的 manifest 里写 CodeConfig + Quota 两句声明,这个文件谁也不认识:
// 它遍历 manifest,把声明接到通用机制上。

package axiscap

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capquota"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// CodeFieldSurface —— 所有能力在码上占的字段,合成 access 收的那一个口子。
//
// 两个能力抢同一个字段名 → panic。这是启动期的事实错误,不是运行期的坏运气。
//
//nolint:ireturn // access 那边收的就是这个接口
func CodeFieldSurface(d *deps.Runtime) access.CodeExtras {
	caps := []capconfig.CodeCap{}
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		if len(m.CodeConfig) == 0 {
			continue
		}
		store := CapabilityStorage(d, m)
		if store == nil {
			d.Log.Error("capability declares code fields but has no storage", "cap", m.ID)
			continue
		}
		caps = append(caps, capconfig.CodeCap{
			Store: CapConfigFor(store, m.ID), Decl: m.CodeConfig, CapID: m.ID,
		})
	}
	fields, err := capconfig.NewCodeFields(d.Log, caps)
	if err != nil {
		panic(err)
	}
	return fields
}

// CapabilityQuotaHooks —— 声明了 Quota 的能力各拿一对钩子:闸(露不露这个工具)和余量
// (还剩几次)。**两者共用同一条计数** —— 它们曾经是两段分开写的代码,而且只补回过一半。
func CapabilityQuotaHooks(d *deps.Runtime, hooks map[string]capload.CapHooks) {
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		counter := quotaCounterFor(d, m)
		if counter == nil {
			continue
		}
		h := hooks[m.ID]
		h.Gate = quotaGate(counter, d.Log, m.ID)
		h.State = quotaState(counter, m.ID)
		hooks[m.ID] = h
	}
}

func quotaCounterFor(d *deps.Runtime, m *mcpplugin.Manifest) *capquota.Counter {
	if !m.Quota.Usable() {
		return nil
	}
	store := CapabilityStorage(d, m)
	if store == nil {
		d.Log.Error("capability declares a quota but has no storage", "cap", m.ID)
		return nil
	}
	return capquota.New(&capquota.Bind{
		Store: store, Config: CapConfigFor(store, m.ID), Decl: m.Quota,
		CodeFields: m.CodeConfig, CapID: m.ID, Kind: capstore.KindMCP,
	})
}

// quotaGate —— 达上限 → 这次会话不暴露这个工具(隐藏,而不是让访客点了再报错)。
//
// 拦下来要**说出来**:被闸掉的症状是"授了权的工具不见了",跟没授权、没连连接器长得一模一样。
// 不留一行日志,查的人只能一个一个闸去试。
func quotaGate(counter *capquota.Counter, log *slog.Logger, capID string) capreg.SessionGate {
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		allow, err := counter.Allow(ctx, in.CodeID)
		if err != nil {
			log.Warn("capability quota check failed — hiding the tool",
				"cap", capID, "code", in.CodeID, "err", err)
			return false, fmt.Errorf("capability %q quota: %w", capID, err)
		}
		if !allow {
			log.Info("capability quota exhausted — tool hidden for this session",
				"cap", capID, "code", in.CodeID)
		}
		return allow, nil
	}
}

// quotaState —— 把还剩几次填进 capability_state.quota_remaining。
// 读不到就不填(omitempty),而不是填 0:0 会被读成"已用尽"。
func quotaState(counter *capquota.Counter, capID string) capload.StateHook {
	return func(ctx context.Context, in *capreg.AssembleInput) capreg.CapabilityState {
		st := capreg.CapabilityState{ID: capID, Enabled: true}
		left, err := counter.Remaining(ctx, in.CodeID)
		if err != nil {
			return st
		}
		st.QuotaRemaining = left
		return st
	}
}
