// marketplace.go —— 逛 skill 市场(GitHub + SkillsMP)并装一个进来。
//
// 装进来的产物就是一个 skill,所以出站形状跟 skills.go 用**同一个** skillOut ——
// 这正是这两组要放在一起的原因:分开就会留下两份"一个 skill 长什么样"。
//
// install_manual 只在面板上:它是"把手里的 SKILL.md 粘进来"这个浏览器动作。MCP 客户端
// 要造 skill 用 skill_create,不需要粘贴这一步 —— 这是写下来的单面决定,不是漏掉的面。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/usecase"
)

// marketSearchDefaultLimit —— 一页结果。
const marketSearchDefaultLimit = 24

// Marketplace —— search / install / install_manual。
func Marketplace(deps usecase.InstallSkillDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "marketplace.search",
			Description: "Search the skill marketplace (GitHub plus the SkillsMP directory). " +
				"Returns matching skills with their source, id, name, version and " +
				"description. Read-only.",
			InputSchema: marketSearchSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      searchMarketplace(deps),
		},
		{
			ID: "marketplace.install",
			Description: "Install a marketplace skill by source and id: fetch its SKILL.md " +
				"and persist it as a source='marketplace' owner skill. name and version are " +
				"fallbacks for when the frontmatter omits them.",
			InputSchema: marketInstallSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      installSkill(deps),
		},
		{
			ID: "marketplace.install_manual",
			Description: "Install a SKILL.md the owner pasted in — no marketplace, no network. " +
				"Parses frontmatter and body, persists it as source='manual'.",
			InputSchema: marketManualSchema,
			Kind:        fp.Action,
			Reach: fp.Only(
				"pasting a SKILL.md is a browser affordance; MCP clients compose skills "+
					"with skill_create instead", "admin"),
			Invoke: installManualSkill(deps),
		},
	}
}

var (
	marketSearchSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"query":{"type":"string","description":"Free-text search query."},
			"source":{"type":"string",
				"description":"Optional filter: 'github' | 'skillsmp' (default all)."},
			"limit":{"type":"integer","description":"Page size (default 24)."},
			"offset":{"type":"integer","description":"Page offset (default 0)."}
		}
	}`)

	marketInstallSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"source":{"type":"string","description":"'github' | 'skillsmp'."},
			"id":{"type":"string",
				"description":"Market skill id (github dir name / skillsmp id)."},
			"source_url":{"type":"string","description":"Optional direct SKILL.md URL."},
			"name":{"type":"string","description":"Fallback display name."},
			"version":{"type":"string","description":"Optional version tag."}
		},
		"required":["source","id"]
	}`)

	marketManualSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"skill_md":{"type":"string","description":"The whole SKILL.md text."},
			"name":{"type":"string","description":"Fallback display name."}
		},
		"required":["skill_md"]
	}`)
)

// marketSkillOut —— 市场里一条结果的出站形状。
type marketSkillOut struct {
	// RepoStars —— 技能所在**仓库**的星数;null = 这个源报不出来。
	// 不许在这里兜底成 0:那会把"不知道"说成"零颗星"(F-F-2)。
	RepoStars   *int   `json:"repo_stars"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Category    string `json:"category"`
	Description string `json:"description"`
	SourceURL   string `json:"source_url"`
	Source      string `json:"source"`
}

type marketSearchArgs struct {
	Query  string `json:"query"`
	Source string `json:"source"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

func searchMarketplace(deps usecase.InstallSkillDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMarketSearch(raw)
		if perr != nil {
			return nil, perr
		}
		items := usecase.SearchMarketplace(ctx,
			usecase.SearchDeps{Client: deps.Marketplace},
			usecase.SearchParams{
				Query: in.Query, Source: in.Source, Limit: in.Limit, Offset: in.Offset,
			})
		return json.Marshal(toMarketSkillOut(items))
	}
}

// decodeMarketSearch —— 参数全可选:空 body 就是"逛整个市场"。
func decodeMarketSearch(raw json.RawMessage) (marketSearchArgs, error) {
	var in marketSearchArgs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fp.BadInput("invalid arguments: " + err.Error())
		}
	}
	if in.Limit <= 0 {
		in.Limit = marketSearchDefaultLimit
	}
	return in, nil
}

func toMarketSkillOut(items []entity.MarketSkill) []marketSkillOut {
	out := make([]marketSkillOut, 0, len(items))
	for i := range items {
		out = append(out, marketSkillOut{
			ID: items[i].ID, Name: items[i].Name, Author: items[i].Author,
			Version: items[i].Version, Category: items[i].Category,
			Description: items[i].Description, SourceURL: items[i].SourceURL,
			Source: string(items[i].Source), RepoStars: items[i].RepoStars,
		})
	}
	return out
}

type marketInstallArgs struct {
	Source    string `json:"source"`
	ID        string `json:"id"`
	SourceURL string `json:"source_url"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	SkillMD   string `json:"skill_md"`
}

func installSkill(deps usecase.InstallSkillDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMarketInstall(raw)
		if perr != nil {
			return nil, perr
		}
		skill, err := usecase.InstallSkill(ctx, deps, &usecase.InstallSkillInput{
			OwnerID: ownerID, Source: in.Source, ID: in.ID,
			SourceURL: in.SourceURL, Name: in.Name, Version: in.Version,
		})
		if err != nil {
			return nil, installErr(err)
		}
		return json.Marshal(toSkillOut(&skill))
	}
}

func decodeMarketInstall(raw json.RawMessage) (marketInstallArgs, error) {
	var in marketInstallArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"source", in.Source}, [2]string{"id", in.ID})
}

func installManualSkill(deps usecase.InstallSkillDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketInstallArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		skill, err := usecase.InstallManualSkill(ctx, deps, ownerID, in.SkillMD, in.Name)
		if err != nil {
			return nil, installErr(err)
		}
		return json.Marshal(toSkillOut(&skill))
	}
}

// installErr —— 安装失败的分类。抓不到 / 解不动远端的 SKILL.md 是**外部依赖**的问题:
// 这句话可以直接给 owner 看,而不是一句 "internal error"。
func installErr(err error) error {
	switch {
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.BadInput("source, id, and a non-empty SKILL.md are required")
	case errors.Is(err, entity.ErrSkillNameTaken):
		return fp.Coded(
			fp.Conflict("a skill with that name is already installed"), "skill_name_taken")
	}
	return fp.Coded(
		fp.Upstream("could not fetch or parse the skill — check the source."), "install_failed")
}
