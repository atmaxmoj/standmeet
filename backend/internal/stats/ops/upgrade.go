// upgrade.go —— 「这台实例还能不能更新」以及「让它更新」。
//
//	instance.upgrade_check   跑着哪一版 / 发布了哪一版 / 这台实例按得动按钮吗
//	instance.upgrade         请编排方重新部署
//
// 分工的要害:**这台实例没有宿主控制权**(backend 刻意不挂 docker.sock),所以升级这件事
// 它自己做不了。它能做的只有"请编排方做",而那条路的权限由 owner 亲手给。给了就按得动,
// 没给就如实说按不动 —— 提供一个做不到的动作,比不提供更坏。
//
// upgrade 只报"请求打出去了",不报"升级成功了"。这个进程自己就在被替换的东西里面,
// 它活不到能回答后一句;真回执由浏览器轮询 /api/v1/instance 的 version 量出来。

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// ReleaseSource —— 镜像库那边最新发布的是哪一版。出站 HTTP 在组装根,域只见这一个口。
type ReleaseSource interface {
	LatestVersion(ctx context.Context) (string, error)
	// Newer —— candidate 比 current 新吗。版本号怎么比是发行渠道的规矩,不是这个域的。
	Newer(current, candidate string) bool
	// Released —— 这个字符串是个发行版本号吗。"什么算发行版本"跟"怎么比"是同一套规矩,
	// 所以由同一方回答;前端不许自己再写一份正则(那就是两份会走散的规矩)。
	Released(version string) bool
}

// Redeploy —— 请编排方重新部署这台实例。Configured 为假时 Trigger 必然失败,
// 面板据此把按钮画成"做不到"而不是画成能按。
type Redeploy interface {
	Configured() bool
	Trigger(ctx context.Context) error
}

// UpgradeSources —— 升级要的两个**外部**口。成对出现,所以一起传:组装根一处构造,
// 运行时一个字段。
type UpgradeSources struct {
	Releases ReleaseSource
	Deploy   Redeploy
}

// UpgradeDeps —— 升级这一组要的来源:进程自己知道的那一份 + 两个外部口。
type UpgradeDeps struct {
	UpgradeSources

	System SystemInfoSource
}

// Upgrade —— 两个口:查 + 做。
func Upgrade(deps UpgradeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "instance.upgrade_check",
			Description: "Which version this instance runs, the newest version published to " +
				"the release registry, and whether this instance can apply an upgrade itself " +
				"(it can only when the owner configured a redeploy hook).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      upgradeCheck(deps),
		},
		{
			ID: "instance.upgrade",
			Description: "Ask whatever orchestrates this instance to redeploy it, pulling the " +
				"newest images. Reports only that the request went out — the process serving " +
				"this call is itself being replaced, so it cannot report the outcome. Read the " +
				"version back afterwards to see what actually happened.",
			InputSchema: noArgs,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      upgradeApply(deps.Deploy),
		},
	}
}

type upgradeCheckOut struct {
	Current string `json:"current"`
	Latest  string `json:"latest"`
	Error   string `json:"error"`
	// Comparable —— 跑着的这一版是个**发行版本号**吗。未盖章的构建(自己 build 出来的
	// "dev")比不了 —— 而"比不了"绝不能报成"你已经是最新的"。那正是刚修掉的那一类谎:
	// 一个跟事实无关的答案,看起来像知道。
	Comparable bool `json:"comparable"`
	Available  bool `json:"available"`
	CanApply   bool `json:"can_apply"`
}

// upgradeCheck —— 问不到镜像库不算故障:自托管的实例可能根本没有出网。那种情况下
// `latest` 留空 + `error` 说明为什么,而 `current` 照常给 —— 拿不到远端不该连
// "我在跑哪一版"都一起丢掉。
func upgradeCheck(deps UpgradeDeps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		out := upgradeCheckOut{
			Current:  deps.System.SystemInfo(ctx).Version,
			CanApply: deps.Deploy.Configured(),
		}
		latest, err := deps.Releases.LatestVersion(ctx)
		if err != nil {
			out.Error = err.Error()
			return json.Marshal(out)
		}
		out.Latest = latest
		out.Comparable = deps.Releases.Released(out.Current)
		out.Available = deps.Releases.Newer(out.Current, latest)
		return json.Marshal(out)
	}
}

type upgradeApplyOut struct {
	Requested bool `json:"requested"`
}

func upgradeApply(deploy Redeploy) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		if err := deploy.Trigger(ctx); err != nil {
			return nil, err
		}
		return json.Marshal(upgradeApplyOut{Requested: true})
	}
}
