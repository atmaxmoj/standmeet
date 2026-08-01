// wire_disp_codes_acl.go —— 一张码的 ACL 面(三类拒绝 + 引导目的地)→ 出站收口的窄口。
//
// 三类拒绝落在两个仓储方法族上(capability/skill 一族、corpus URI 一族),这里按 kind 分派;
// 收口那侧只看见"加一条 / 删一条 / 列出来",不需要知道它们分开存。

package main

import (
	"context"
	"encoding/json"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

func (a codeOps) Denials(
	ctx context.Context, _, codeID string,
) (dispatcher.CodeDenials, error) {
	caps, cerr := a.denials.ListCapabilities(ctx, codeID)
	if cerr != nil {
		return dispatcher.CodeDenials{}, codeErr(cerr)
	}
	skills, serr := a.denials.ListSkills(ctx, codeID)
	if serr != nil {
		return dispatcher.CodeDenials{}, codeErr(serr)
	}
	uris, uerr := a.denials.ListCorpusURIs(ctx, codeID)
	if uerr != nil {
		return dispatcher.CodeDenials{}, codeErr(uerr)
	}
	return dispatcher.CodeDenials{
		CapabilityIDs: caps, SkillIDs: skills, CorpusURIs: uris,
		CorpusGranted: a.grantedCorpusURIs(ctx, codeID),
	}, nil
}

// grantedCorpusURIs —— 这张码的 role 授的语料正列表。读不到当空:它是对照用的一半,
// 不该让整个 ACL 读失败。
func (a codeOps) grantedCorpusURIs(ctx context.Context, codeID string) []string {
	code, err := a.codes.GetByID(ctx, codeID)
	if err != nil {
		return []string{}
	}
	role, rerr := a.roles.GetByID(ctx, code.OwnerID, code.AssumedRoleID)
	if rerr != nil {
		return []string{}
	}
	return role.CorpusURIs()
}

// SetCorpusDenials —— 整份替换收回列表。不校验 glob 语法:跟 role 的正列表同一种语言,
// 而且这是纯减法 —— 写错顶多少读到东西,不会泄露。
func (a codeOps) SetCorpusDenials(
	ctx context.Context, ownerID, codeID string, uris []string,
) (dispatcher.CodeDenials, error) {
	if err := a.denials.SetCorpusURIs(ctx, codeID, uris); err != nil {
		return dispatcher.CodeDenials{}, codeErr(err)
	}
	return a.Denials(ctx, ownerID, codeID)
}

func (a codeOps) AddDenial(
	ctx context.Context, in *dispatcher.CodeDenialRef,
) (dispatcher.CodeDenials, error) {
	return a.mutateDenial(ctx, in, a.denialAdders())
}

func (a codeOps) RemoveDenial(
	ctx context.Context, in *dispatcher.CodeDenialRef,
) (dispatcher.CodeDenials, error) {
	return a.mutateDenial(ctx, in, a.denialRemovers())
}

// denialWrite —— 写一条拒绝。加和删各有一张表(见下),所以往下传的是**要做的那件事**,
// 而不是一个 add bool —— 布尔控制参数会把"加还是删"的判断一路推到最里层。
type denialWrite func(ctx context.Context, codeID, target string) error

func (a codeOps) denialAdders() map[string]denialWrite {
	return map[string]denialWrite{
		dispatcher.DenialKindCapability: a.denials.AddCapability,
		dispatcher.DenialKindSkill:      a.denials.AddSkill,
		dispatcher.DenialKindCorpus:     a.addCorpusURI,
	}
}

func (a codeOps) denialRemovers() map[string]denialWrite {
	return map[string]denialWrite{
		dispatcher.DenialKindCapability: a.denials.DeleteCapability,
		dispatcher.DenialKindSkill:      a.denials.DeleteSkill,
		dispatcher.DenialKindCorpus:     a.removeCorpusURI,
	}
}

// mutateDenial —— 按 kind 取那一类的写法,写完回读整份。收口那侧只看见"三类拒绝",
// 不需要知道它们落在两个仓储方法族上。
func (a codeOps) mutateDenial(
	ctx context.Context, in *dispatcher.CodeDenialRef, writes map[string]denialWrite,
) (dispatcher.CodeDenials, error) {
	write, ok := writes[in.Kind]
	if !ok {
		//nolint:wrapcheck // 类别错误原样上抛
		return dispatcher.CodeDenials{},
			dispatcher.BadInput("kind must be capability, skill or corpus")
	}
	if err := codeErr(write(ctx, in.CodeID, in.TargetID)); err != nil {
		return dispatcher.CodeDenials{}, err
	}
	return a.Denials(ctx, in.OwnerID, in.CodeID)
}

// corpus 拒绝存的是整份 URI 列表,所以加/删都是读-改-写。
func (a codeOps) addCorpusURI(ctx context.Context, codeID, uri string) error {
	return a.rewriteCorpusURIs(ctx, codeID, func(cur []string) []string {
		return append(withoutString(cur, uri), uri)
	})
}

func (a codeOps) removeCorpusURI(ctx context.Context, codeID, uri string) error {
	return a.rewriteCorpusURIs(ctx, codeID, func(cur []string) []string {
		return withoutString(cur, uri)
	})
}

func (a codeOps) rewriteCorpusURIs(
	ctx context.Context, codeID string, edit func(current []string) []string,
) error {
	current, err := a.denials.ListCorpusURIs(ctx, codeID)
	if err != nil {
		return codeErr(err)
	}
	return codeErr(a.denials.SetCorpusURIs(ctx, codeID, edit(current)))
}

func withoutString(xs []string, drop string) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		if x != drop {
			out = append(out, x)
		}
	}
	return out
}

func (a codeOps) Waypoints(
	ctx context.Context, ownerID, codeID string,
) (dispatcher.CodeWaypoints, error) {
	overrides, err := a.codes.Waypoints(ctx, codeID)
	if err != nil {
		return dispatcher.CodeWaypoints{}, codeErr(err)
	}
	return a.waypointsView(ctx, ownerID, codeID, overrides), nil
}

func (a codeOps) SetWaypoints(
	ctx context.Context, ownerID, codeID string, raw json.RawMessage,
) (dispatcher.CodeWaypoints, error) {
	overrides := []access.Waypoint{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &overrides); err != nil {
			//nolint:wrapcheck // 类别错误原样上抛
			return dispatcher.CodeWaypoints{},
				dispatcher.BadInput("waypoints must be an array of waypoint objects")
		}
	}
	if err := a.codes.SetWaypoints(ctx, codeID, overrides); err != nil {
		return dispatcher.CodeWaypoints{}, codeErr(err)
	}
	return a.waypointsView(ctx, ownerID, codeID, overrides), nil
}

// waypointsView —— 三层全景:role 继承的、这张码覆盖的、合并后生效的。
func (a codeOps) waypointsView(
	ctx context.Context, ownerID, codeID string, overrides []access.Waypoint,
) dispatcher.CodeWaypoints {
	inherited := a.inheritedWaypoints(ctx, ownerID, codeID)
	return dispatcher.CodeWaypoints{
		Inherited: encodeList(inherited),
		Overrides: encodeList(overrides),
		Effective: encodeList(access.MergeWaypoints(inherited, overrides)),
	}
}

// inheritedWaypoints —— 这张码的 role 上配的那份。取不到就当没有:它是展示层的一半,
// 不该让整个读操作失败。
func (a codeOps) inheritedWaypoints(
	ctx context.Context, ownerID, codeID string,
) []access.Waypoint {
	code, err := a.codes.GetByID(ctx, codeID)
	if err != nil {
		return []access.Waypoint{}
	}
	role, rerr := a.roles.GetByID(ctx, ownerID, code.AssumedRoleID)
	if rerr != nil {
		return []access.Waypoint{}
	}
	return role.Waypoints()
}

// 编译期确认:同一个适配器满足收口声明的两个窄口(码本身 + 它的 ACL 面)。
// 组装根合成一个是实现细节;收口那侧看见的是两条独立的线。
var (
	_ dispatcher.CodeStore    = codeOps{}
	_ dispatcher.CodeACLStore = codeOps{}
)
