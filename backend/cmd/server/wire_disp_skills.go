// wire_disp_skills.go —— marketplace 域的 skill / 市场普通函数 → 出站收口的窄口。
//
// skills 和 marketplace 放一个文件:装一个市场 skill 的产物就是一个 skill,
// 两边共用同一份形状转换 —— 分开写就会有两份。

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// skillOps —— marketplace 域的 skill 普通函数 → 收口要的窄口。
type skillOps struct{ deps marketplace.SkillsDeps }

// newSkillOps —— skill 用例要 skill repo + code repo(删之前得看有没有邀请码还在用它)。
func newSkillOps(d *runtimeDeps) skillOps {
	return skillOps{deps: marketplace.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo}}
}

func (a skillOps) List(ctx context.Context, ownerID string) ([]dispatcher.Skill, error) {
	rows, err := marketplace.ListSkills(ctx, a.deps, ownerID)
	if err != nil {
		return nil, skillErr(err)
	}
	out := make([]dispatcher.Skill, 0, len(rows))
	for i := range rows {
		out = append(out, toDispatcherSkill(&rows[i]))
	}
	return out, nil
}

func (a skillOps) Create(
	ctx context.Context, in *dispatcher.CreateSkill,
) (dispatcher.Skill, error) {
	scripts, serr := decodeSkillScripts(in.Scripts)
	if serr != nil {
		return dispatcher.Skill{}, serr
	}
	skill, err := marketplace.CreateSkill(ctx, a.deps, &marketplace.CreateSkillReq{
		OwnerID: in.OwnerID, Name: in.Name, Description: in.Description,
		Prompt: in.Prompt, AllowedTools: in.AllowedTools, Scripts: scripts,
	})
	if err != nil {
		return dispatcher.Skill{}, skillErr(err)
	}
	return toDispatcherSkill(&skill), nil
}

func (a skillOps) SetEnabled(
	ctx context.Context, ownerID, id string, enabled bool,
) (dispatcher.Skill, error) {
	skill, err := marketplace.SetSkillEnabled(ctx, a.deps, ownerID, id, enabled)
	if err != nil {
		return dispatcher.Skill{}, skillErr(err)
	}
	return toDispatcherSkill(&skill), nil
}

func (a skillOps) Delete(ctx context.Context, ownerID, id string) error {
	return skillErr(marketplace.DeleteSkill(ctx, a.deps, ownerID, id))
}

// decodeSkillScripts —— 收口原样透传的沙箱脚本 JSON,在这里才解成域的类型。
// 解不动是调用方给错了。
func decodeSkillScripts(raw json.RawMessage) ([]marketplace.SkillScript, error) {
	scripts := []marketplace.SkillScript{}
	if len(raw) == 0 {
		return scripts, nil
	}
	if err := json.Unmarshal(raw, &scripts); err != nil {
		//nolint:wrapcheck // 类别错误原样上抛
		return nil, dispatcher.BadInput("scripts must be an array of script objects")
	}
	return scripts, nil
}

func toDispatcherSkill(s *marketplace.Skill) dispatcher.Skill {
	return dispatcher.Skill{
		ID: s.ID, Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		Source: s.Source, AllowedTools: s.AllowedTools, IsBuiltin: s.IsBuiltin,
		Enabled: s.Enabled, CreatedAt: s.CreatedAt,
	}
}

// skillErr —— skill 相关的域错误词汇 → 收口的类别。
func skillErr(err error) error {
	if err == nil {
		return nil
	}
	if classed := classifySkillErr(err); classed != nil {
		return classed
	}
	return fmt.Errorf("skill op: %w", err)
}

// classifySkillErr —— 域的错误哨兵 → 收口的类别。**一个哨兵一行**;nil = 不属于任何类别,
// 那就是这台机器的问题。
func classifySkillErr(err error) error {
	for _, c := range skillErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return nil
}

var skillErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return dispatcher.BadInput("name and prompt are required")
	}},
	// code 是已经发出去的契约,显式钉住(不能退成类别默认的 conflict / not_found)。
	{marketplace.ErrSkillNameTaken, func() error {
		return dispatcher.Coded(
			dispatcher.Conflict("a skill with that name is already installed"),
			"skill_name_taken")
	}},
	{marketplace.ErrSkillBuiltinImmutable, func() error {
		return dispatcher.Coded(
			dispatcher.Forbidden("builtin skill cannot be deleted"),
			"skill_builtin_immutable")
	}},
	{marketplace.ErrSkillNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("skill not found"), "skill_not_found")
	}},
}

// marketOps —— 市场检索 + 安装。安装的产物是一个 skill,所以跟 skillOps 共用形状转换。
type marketOps struct{ deps marketplace.InstallSkillDeps }

func newMarketOps(d *runtimeDeps) marketOps {
	return marketOps{deps: marketplace.InstallSkillDeps{
		Marketplace: d.marketplaceClient, Skills: d.skillRepo,
	}}
}

func (a marketOps) Search(
	ctx context.Context, in *dispatcher.MarketSearch,
) ([]dispatcher.MarketSkill, error) {
	items := marketplace.SearchMarketplace(ctx,
		marketplace.SearchDeps{Client: a.deps.Marketplace},
		marketplace.SearchParams{
			Query: in.Query, Source: in.Source, Limit: in.Limit, Offset: in.Offset,
		})
	out := make([]dispatcher.MarketSkill, 0, len(items))
	for i := range items {
		out = append(out, dispatcher.MarketSkill{
			ID: items[i].ID, Name: items[i].Name, Author: items[i].Author,
			Version: items[i].Version, Category: items[i].Category,
			Description: items[i].Description, SourceURL: items[i].SourceURL,
			Source: string(items[i].Source), Stars: items[i].Stars,
		})
	}
	return out, nil
}

func (a marketOps) Install(
	ctx context.Context, in *dispatcher.InstallSkill,
) (dispatcher.Skill, error) {
	skill, err := marketplace.InstallSkill(ctx, a.deps, &marketplace.InstallSkillInput{
		OwnerID: in.OwnerID, Source: in.Source, ID: in.ID,
		SourceURL: in.SourceURL, Name: in.Name, Version: in.Version,
	})
	if err != nil {
		return dispatcher.Skill{}, installErr(err)
	}
	return toDispatcherSkill(&skill), nil
}

func (a marketOps) InstallManual(
	ctx context.Context, ownerID, skillMD, name string,
) (dispatcher.Skill, error) {
	skill, err := marketplace.InstallManualSkill(ctx, a.deps, ownerID, skillMD, name)
	if err != nil {
		return dispatcher.Skill{}, installErr(err)
	}
	return toDispatcherSkill(&skill), nil
}

// installErr —— 安装失败的分类。抓不到 / 解不动远端的 SKILL.md 是**外部依赖**的问题:
// 这句话可以直接给 owner 看,而不是一句 "internal error"。
func installErr(err error) error {
	switch {
	case errors.Is(err, apierr.ErrEmptyField):
		//nolint:wrapcheck // 类别错误原样上抛
		return dispatcher.BadInput("source, id, and a non-empty SKILL.md are required")
	case errors.Is(err, marketplace.ErrSkillNameTaken):
		//nolint:wrapcheck // 同上
		return dispatcher.Coded(
			dispatcher.Conflict("a skill with that name is already installed"),
			"skill_name_taken")
	default:
		//nolint:wrapcheck // 同上
		return dispatcher.Coded(
			dispatcher.Upstream("could not fetch or parse the skill — check the source."),
			"install_failed")
	}
}
