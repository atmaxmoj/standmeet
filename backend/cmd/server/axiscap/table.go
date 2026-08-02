// table.go —— "访客能用什么"这张表怎么装出来(声明在 ops.go)。
//
// 这张表要读四处:能力注册表(有哪些能力 + 它们的 origin)、capability_settings
// (owner 关掉了哪些)、owner 自己的 skill、连接器槽(日历 / 邮件连上没有)。
// 两根插件轴在这一侧,所以这段跨四处的编排也在这一侧。

package axiscap

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// connector kind 的稳定行 id(可关不可删 —— 断开而不是删掉)。
const (
	connectorGCalRowID = "connector.google-calendar"
	connectorMailRowID = "connector.smtp"
)

type capabilityOps struct {
	registry   *capreg.Registry
	settings   *access.CapabilityRepo
	skills     *marketplace.SkillRepo
	connectors *connector.Repo
}

func newCapabilityOps(d *deps.Runtime) capabilityOps {
	return capabilityOps{
		registry: d.AgentSkills, settings: d.CapabilityRepo,
		skills: d.SkillRepo, connectors: d.ConnectorRepo,
	}
}

// capabilityFacts —— 装配一次列表所需的全部 IO 结果,一次读齐。
type capabilityFacts struct {
	disabled map[string]bool
	skills   []marketplace.Skill
	gcal     bool
	mail     bool
}

func (a capabilityOps) List(ctx context.Context, ownerID string) ([]capabilityRow, error) {
	facts, err := a.load(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("load capability facts: %w", err)
	}
	rows := a.registryRows(&facts)
	rows = append(rows, connectorSlotRows(&facts)...)
	return append(rows, ownerSkillRows(&facts)...), nil
}

// SetEnabled —— 开关写到**真正读它的**那张表:注册表能力 → capability_settings;
// owner skill → skill 自己的 Enabled。connector 行前端锁死,不走这条。
func (a capabilityOps) SetEnabled(ctx context.Context, ownerID, id string, enabled bool) error {
	if _, ok := a.registry.OriginOf(id); ok {
		if err := a.settings.SetEnabled(ctx, ownerID, id, enabled); err != nil {
			return fmt.Errorf("set capability enabled: %w", err)
		}
		return nil
	}
	if _, err := a.skills.SetEnabled(ctx, ownerID, id, enabled); err != nil {
		return fmt.Errorf("set skill enabled: %w", err)
	}
	return nil
}

// Delete —— 只有 owner 自己写的 skill 可删。注册表能力(builtin/managed)和 connector 行都拒。
func (a capabilityOps) Delete(ctx context.Context, ownerID, id string) error {
	if !a.deletable(id) {
		return fp.BadInput("this capability is built in and cannot be deleted")
	}
	if err := a.skills.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete owner skill: %w", err)
	}
	return nil
}

func (a capabilityOps) load(ctx context.Context, ownerID string) (capabilityFacts, error) {
	disabled, derr := a.settings.DisabledSet(ctx, ownerID)
	if derr != nil {
		return capabilityFacts{}, fmt.Errorf("disabled set: %w", derr)
	}
	skills, serr := a.skills.ListByOwner(ctx, ownerID)
	if serr != nil {
		return capabilityFacts{}, fmt.Errorf("list owner skills: %w", serr)
	}
	return capabilityFacts{
		disabled: disabled, skills: skills,
		gcal: a.categoryConnected(ctx, ownerID, "calendar"),
		mail: a.categoryConnected(ctx, ownerID, "mail"),
	}, nil
}

// categoryConnected —— 品类槽里有没有一个 active 且已连的连接器。读失败当作没连:
// 这是个展示状态,不该让整张表打不开。
func (a capabilityOps) categoryConnected(ctx context.Context, ownerID, category string) bool {
	ok, err := a.connectors.CategoryConnected(ctx, ownerID, category)
	return err == nil && ok
}

// registryRows —— 注册表里**面向访客**的能力各一行。
//
// owner-only 的不列:owner-enable 闸只作用于访客装配,给它们放一个开关,那个开关什么都不做。
func (a capabilityOps) registryRows(facts *capabilityFacts) []capabilityRow {
	caps := a.registry.List()
	out := make([]capabilityRow, 0, len(caps))
	for _, c := range caps {
		if c.Shape() == capreg.ShapeOwnerOnly {
			continue
		}
		id := c.ID()
		origin, _ := a.registry.OriginOf(id)
		out = append(out, capabilityRow{
			ID: id, Title: capabilityTitleOf(c), Origin: string(origin), Kind: "capability",
			Enabled: !facts.disabled[id], Deletable: origin.Deletable(),
			Dependency: dependencyOf(id, facts),
		})
	}
	return out
}

func (a capabilityOps) deletable(id string) bool {
	if _, ok := a.registry.OriginOf(id); ok {
		return false
	}
	return id != connectorGCalRowID && id != connectorMailRowID
}

func capabilityTitleOf(c capreg.Capability) string {
	if t, ok := c.(capreg.Titled); ok {
		return t.Title()
	}
	return ""
}

// dependencyOf —— 这个能力等的是哪个连接器,连上没有。没有依赖返 nil。
func dependencyOf(id string, facts *capabilityFacts) *capabilityDependency {
	switch id {
	case "calendar.book":
		return &capabilityDependency{Name: "Google Calendar", Connected: facts.gcal}
	case "mail.send":
		return &capabilityDependency{Name: "Mail", Connected: facts.mail}
	default:
		return nil
	}
}

// connectorSlotRows —— 平台托管的连接器槽各一行。可关不可删(断开,不是删掉)。
func connectorSlotRows(facts *capabilityFacts) []capabilityRow {
	managed := string(capreg.OriginManaged)
	return []capabilityRow{
		{
			ID: connectorGCalRowID, Origin: managed, Kind: "connector",
			Enabled: facts.gcal, Deletable: false,
			Dependency: &capabilityDependency{Name: "Google Calendar", Connected: facts.gcal},
		},
		{
			ID: connectorMailRowID, Origin: managed, Kind: "connector",
			Enabled: facts.mail, Deletable: false,
			Dependency: &capabilityDependency{Name: "SMTP", Connected: facts.mail},
		},
	}
}

// ownerSkillRows —— owner 自己写的 skill 各一行。
//
// enabled 读的是 **skill 自己**的全局开关(skill runner 真读的那个),不是
// capability_settings —— skill 不是注册表能力,别拿 owner-enable 闸的表当它的真值。
func ownerSkillRows(facts *capabilityFacts) []capabilityRow {
	out := make([]capabilityRow, 0, len(facts.skills))
	for i := range facts.skills {
		s := &facts.skills[i]
		if s.IsBuiltin {
			continue // 内建 skill 不算 owner-origin,不可删
		}
		out = append(out, capabilityRow{
			ID: s.ID, Origin: string(capreg.OriginOwner), Kind: "skill",
			Enabled: s.Enabled, Deletable: true,
		})
	}
	return out
}
