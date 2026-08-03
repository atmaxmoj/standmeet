// code_acl.go —— 一张码的权限收窄:三类拒绝 + 引导目的地。
//
// 拒绝有三种(capability / skill / corpus URI),它们是同一件事的三个维度:在 role 给的
// 范围上再减一层。三种落在两个仓储方法族上(离散 id 一族、整份 glob 列表一族),按 kind
// 分派、corpus 那类的读-改-写、以及 waypoints 的"继承 + 覆盖 = 生效"三层合并 —— 这些都
// 是**这件事怎么算**,不是某个面怎么表达,所以住在域里。
//
// 以前它们长在组装根的适配器上,于是同一件事换个入口就可能算得不一样。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
)

// 拒绝的三种 kind —— 每个面用同一套词。
const (
	DenialKindCapability = "capability"
	DenialKindSkill      = "skill"
	DenialKindCorpus     = "corpus"
)

// CodeACLDeps —— 权限收窄这组用例需要的 repos。Roles 用来读 role 授的那一半。
type CodeACLDeps struct {
	Codes   *repo.CodeRepo
	Denials *repo.CodeDenialRepo
	Roles   *repo.RoleRepo
}

// CodeDenials —— 一张码的三类拒绝,外加 role 在语料上**授**了什么。
//
// 带上 CorpusGranted 是因为收回只有对着正列表看才有意义:owner 要判断"这张码还能看什么",
// 光看收回列表看不出来。
type CodeDenials struct {
	CapabilityIDs []string
	SkillIDs      []string
	CorpusURIs    []string
	CorpusGranted []string
}

// CodeDenialRef —— 加/删一条拒绝。Kind 取 capability / skill / corpus。
type CodeDenialRef struct {
	OwnerID  string
	CodeID   string
	Kind     string
	TargetID string
}

// ListCodeDenials —— 读全三类,外加对照用的正列表。**先确认这张码是这个 owner 的**。
func ListCodeDenials(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string,
) (CodeDenials, error) {
	if err := ownsCode(ctx, d, ownerID, codeID); err != nil {
		return CodeDenials{}, err
	}
	return listDenials(ctx, d, codeID)
}

// listDenials —— 三类拒绝的原始读。归属已经确认过的路径走这条,不重复查一次码。
func listDenials(ctx context.Context, d CodeACLDeps, codeID string) (CodeDenials, error) {
	caps, cerr := d.Denials.ListCapabilities(ctx, codeID)
	if cerr != nil {
		return CodeDenials{}, fmt.Errorf("list code denials: %w", cerr)
	}
	skills, serr := d.Denials.ListSkills(ctx, codeID)
	if serr != nil {
		return CodeDenials{}, fmt.Errorf("list code denials: %w", serr)
	}
	uris, uerr := d.Denials.ListCorpusURIs(ctx, codeID)
	if uerr != nil {
		return CodeDenials{}, fmt.Errorf("list code denials: %w", uerr)
	}
	return CodeDenials{
		CapabilityIDs: caps, SkillIDs: skills, CorpusURIs: uris,
		CorpusGranted: grantedCorpusURIs(ctx, d, codeID),
	}, nil
}

// grantedCorpusURIs —— 这张码的 role 授的语料正列表。读不到当空:它是对照用的一半,
// 不该让整个 ACL 读失败。
func grantedCorpusURIs(ctx context.Context, d CodeACLDeps, codeID string) []string {
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return []string{}
	}
	role, rerr := d.Roles.GetByID(ctx, code.OwnerID, code.AssumedRoleID)
	if rerr != nil {
		return []string{}
	}
	return role.CorpusURIs()
}

// AddCodeDenial —— 加一条。幂等。
func AddCodeDenial(
	ctx context.Context, d CodeACLDeps, in *CodeDenialRef,
) (CodeDenials, error) {
	return writeCodeDenial(ctx, d, in, denialAdders(d))
}

// RemoveCodeDenial —— 撤一条。幂等。
func RemoveCodeDenial(
	ctx context.Context, d CodeACLDeps, in *CodeDenialRef,
) (CodeDenials, error) {
	return writeCodeDenial(ctx, d, in, denialRemovers(d))
}

// SetCodeCorpusDenials —— 整份替换收回列表。不校验 glob 语法:跟 role 的正列表同一种
// 语言,而且这是纯减法 —— 写错顶多少读到东西,不会泄露。
func SetCodeCorpusDenials(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string, uris []string,
) (CodeDenials, error) {
	if err := ownsCode(ctx, d, ownerID, codeID); err != nil {
		return CodeDenials{}, err
	}
	if err := d.Denials.SetCorpusURIs(ctx, codeID, uris); err != nil {
		return CodeDenials{}, fmt.Errorf("set corpus denials: %w", err)
	}
	return listDenials(ctx, d, codeID)
}

// denialWrite —— 写一条拒绝。加和删各有一张表(见下),所以往下传的是**要做的那件事**,
// 而不是一个 add bool —— 布尔控制参数会把"加还是删"的判断一路推到最里层。
type denialWrite func(ctx context.Context, codeID, target string) error

func denialAdders(d CodeACLDeps) map[string]denialWrite {
	return map[string]denialWrite{
		DenialKindCapability: d.Denials.AddCapability,
		DenialKindSkill:      d.Denials.AddSkill,
		DenialKindCorpus:     addCorpusURI(d),
	}
}

func denialRemovers(d CodeACLDeps) map[string]denialWrite {
	return map[string]denialWrite{
		DenialKindCapability: d.Denials.DeleteCapability,
		DenialKindSkill:      d.Denials.DeleteSkill,
		DenialKindCorpus:     removeCorpusURI(d),
	}
}

// writeCodeDenial —— 先确认这张码是**这个 owner 的**,再按 kind 取那一类的写法,写完回读整份。
//
// 归属这一问一度不在这儿:入参里带着 OwnerID,却一路没人看。后果是拿到任何一个 code id
// (甚至一个不存在的)就能往上写拒绝 —— 多租户下那是越权写别人的码。ACL 的写路径上,
// "这东西是不是你的"必须先问,而不是靠调用方只传自己的 id。
func writeCodeDenial(
	ctx context.Context, d CodeACLDeps, in *CodeDenialRef, writes map[string]denialWrite,
) (CodeDenials, error) {
	write, ok := writes[in.Kind]
	if !ok {
		return CodeDenials{}, entity.ErrDenialKindUnknown
	}
	if err := ownsCode(ctx, d, in.OwnerID, in.CodeID); err != nil {
		return CodeDenials{}, err
	}
	if err := write(ctx, in.CodeID, in.TargetID); err != nil {
		return CodeDenials{}, fmt.Errorf("write code denial: %w", err)
	}
	return listDenials(ctx, d, in.CodeID)
}

// ownsCode —— 这张码归这个 owner 吗。不存在和不属于你,对外是**同一个**答案:
// 否则这个端点就成了一台"这个 id 存在吗"的探测器。
func ownsCode(ctx context.Context, d CodeACLDeps, ownerID, codeID string) error {
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return fmt.Errorf("owns code: %w", err)
	}
	if code.OwnerID != ownerID {
		return entity.ErrCodeInvalid
	}
	return nil
}

// corpus 拒绝存的是整份 URI 列表,所以加/删都是读-改-写。
func addCorpusURI(d CodeACLDeps) denialWrite {
	return func(ctx context.Context, codeID, uri string) error {
		return rewriteCorpusURIs(ctx, d, codeID, func(cur []string) []string {
			return append(withoutString(cur, uri), uri)
		})
	}
}

func removeCorpusURI(d CodeACLDeps) denialWrite {
	return func(ctx context.Context, codeID, uri string) error {
		return rewriteCorpusURIs(ctx, d, codeID, func(cur []string) []string {
			return withoutString(cur, uri)
		})
	}
}

func rewriteCorpusURIs(
	ctx context.Context, d CodeACLDeps, codeID string, edit func(current []string) []string,
) error {
	current, err := d.Denials.ListCorpusURIs(ctx, codeID)
	if err != nil {
		return fmt.Errorf("rewrite corpus denials: %w", err)
	}
	if serr := d.Denials.SetCorpusURIs(ctx, codeID, edit(current)); serr != nil {
		return fmt.Errorf("rewrite corpus denials: %w", serr)
	}
	return nil
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

// CodeWaypointsView —— 引导目的地的三层:role 继承的、这张码覆盖的、合并后实际生效的。
type CodeWaypointsView struct {
	Inherited []entity.Waypoint
	Overrides []entity.Waypoint
	Effective []entity.Waypoint
}

// CodeWaypoints —— 读这张码的三层。
func CodeWaypoints(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string,
) (CodeWaypointsView, error) {
	overrides, err := d.Codes.Waypoints(ctx, codeID)
	if err != nil {
		return CodeWaypointsView{}, fmt.Errorf("read waypoints: %w", err)
	}
	return waypointsView(ctx, d, ownerID, codeID, overrides), nil
}

// SetCodeWaypoints —— 写覆盖层。空列表 = 清掉覆盖,回到继承 role 的那份。
func SetCodeWaypoints(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string, overrides []entity.Waypoint,
) (CodeWaypointsView, error) {
	if err := d.Codes.SetWaypoints(ctx, codeID, overrides); err != nil {
		return CodeWaypointsView{}, fmt.Errorf("set waypoints: %w", err)
	}
	return waypointsView(ctx, d, ownerID, codeID, overrides), nil
}

func waypointsView(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string, overrides []entity.Waypoint,
) CodeWaypointsView {
	inherited := inheritedWaypoints(ctx, d, ownerID, codeID)
	return CodeWaypointsView{
		Inherited: inherited,
		Overrides: overrides,
		Effective: entity.MergeWaypoints(inherited, overrides),
	}
}

// inheritedWaypoints —— 这张码的 role 上配的那份。取不到就当没有:它是三层里的一层,
// 不该让整个读操作失败。
func inheritedWaypoints(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string,
) []entity.Waypoint {
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return []entity.Waypoint{}
	}
	role, rerr := d.Roles.GetByID(ctx, ownerID, code.AssumedRoleID)
	if rerr != nil {
		return []entity.Waypoint{}
	}
	return role.Waypoints()
}
