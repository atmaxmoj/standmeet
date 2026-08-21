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
	fields, err := capconfig.NewCodeFields(d.Log, subjectCaps(d, "code", codeDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// RoleFieldSurface —— 所有能力在一个 role 上占的字段,合成 access 收的那一个口子。
//
// 跟 CodeFieldSurface 差的只有"取哪份声明"。calendar.book 的 notify_owner 是第一个;
// 在它之前,一个 per-role 的开关只能长成内核 roles 表上的一列。
//
//nolint:ireturn // access 那边收的就是这个接口
func RoleFieldSurface(d *deps.Runtime) access.RoleExtras {
	fields, err := capconfig.NewRoleFields(d.Log, subjectCaps(d, "role", roleDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// KeyFieldSurface —— 所有能力在一把**对外 API key** 上占的字段,合成 access 收的那一个口子。
//
// 用的是**跟码同一份声明**(`CodeConfig`):`max_bookings` 是「这个主体最多能约几次」,它跟主体
// 是码还是 key 无关。没有这一面的话,配额挂在 key 上就无处可设(F-B-11)。
//
//nolint:ireturn // access 那边收的就是这个接口
func KeyFieldSurface(d *deps.Runtime) access.KeyExtras {
	fields, err := capconfig.NewKeyFields(d.Log, subjectCaps(d, "api_key", codeDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// RoleCapConfig —— 冻结 role snapshot 时按能力读配置的那个读口(conversation 侧的窄端口)。
// 跟 RoleFieldSurface 同一份声明、同一个存储:两个形状,一份事实。
func RoleCapConfig(d *deps.Runtime) *capconfig.SubjectFields {
	fields, err := capconfig.NewRoleFields(d.Log, subjectCaps(d, "role", roleDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

func codeDecl(m *mcpplugin.Manifest) []mcpplugin.ConfigField { return m.CodeConfig }
func roleDecl(m *mcpplugin.Manifest) []mcpplugin.ConfigField { return m.RoleConfig }

// subjectCaps —— 声明了这类字段的能力 + 它们各自的存储。声明了却没有存储 → 记一条并跳过:
// 那是启动期的配置错误,静默跳过的话 owner 只会看到设置存不下去。
func subjectCaps(
	d *deps.Runtime, subject string, decl func(*mcpplugin.Manifest) []mcpplugin.ConfigField,
) []capconfig.SubjectCap {
	caps := []capconfig.SubjectCap{}
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		fields := decl(m)
		if len(fields) == 0 {
			continue
		}
		store := CapabilityStorage(d, m)
		if store == nil {
			d.Log.Error("capability declares subject fields but has no storage",
				"subject", subject, "cap", m.ID)
			continue
		}
		caps = append(caps, capconfig.SubjectCap{
			Store: CapConfigFor(store, m.ID), Decl: fields, CapID: m.ID,
		})
	}
	return caps
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
		// 同一份字段声明既用在码上也用在 key 上 —— 上限那个字段本身跟挂在谁身上无关。
		SubjectFields: m.CodeConfig, CapID: m.ID, Kind: capstore.KindMCP,
	})
}

// quotaScope —— 会话主体 → 它的配置挂载点。**这句翻译只能住在组装根**:capreg 认识「一场
// 会话以谁的身份跑」,capconfig 认识「配置挂在谁身上」,两个包互不认识(架构闸拦着),而这里
// 两边都看得见。
//
// 不给兜底:种类不认得就当没有主体(不闸)。兜一个默认 scope 的话,一个拼错的种类会静默地去读
// 别人的上限 —— 配额是最不该"猜一个"的地方。
func quotaScope(s capreg.Subject) capconfig.Scope {
	switch s.Kind {
	case capreg.SubjectCode:
		return capconfig.CodeScope(s.ID)
	case capreg.SubjectAPIKey:
		return capconfig.KeyScope(s.ID)
	default:
		return capconfig.Scope{}
	}
}

// quotaGate —— 达上限 → 这次会话不暴露这个工具(隐藏,而不是让访客点了再报错)。
//
// 拦下来要**说出来**:被闸掉的症状是"授了权的工具不见了",跟没授权、没连连接器长得一模一样。
// 不留一行日志,查的人只能一个一个闸去试。
func quotaGate(counter *capquota.Counter, log *slog.Logger, capID string) capreg.SessionGate {
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		allow, err := counter.Allow(ctx, quotaScope(in.Subject))
		if err != nil {
			log.Warn("capability quota check failed — hiding the tool",
				"cap", capID, "subject_kind", in.Subject.Kind,
				"subject", in.Subject.ID, "err", err)
			return false, fmt.Errorf("capability %q quota: %w", capID, err)
		}
		if !allow {
			log.Info("capability quota exhausted — tool hidden for this session",
				"cap", capID, "subject_kind", in.Subject.Kind, "subject", in.Subject.ID)
			// 带上**理由**再往上走。它包着 ErrHidden,所以聊天面照旧藏;而 HTTP 那一面
			// 问得出「为什么没有」,不必把额度用完说成从来没授权(F-B-11)。
			return false, capreg.ErrQuotaExhausted
		}
		return allow, nil
	}
}

// quotaState —— 把还剩几次填进 capability_state.quota_remaining。
// 读不到就不填(omitempty),而不是填 0:0 会被读成"已用尽"。
func quotaState(counter *capquota.Counter, capID string) capload.StateHook {
	return func(ctx context.Context, in *capreg.AssembleInput) capreg.CapabilityState {
		st := capreg.CapabilityState{ID: capID, Enabled: true}
		left, err := counter.Remaining(ctx, quotaScope(in.Subject))
		if err != nil {
			return st
		}
		st.QuotaRemaining = left
		return st
	}
}
