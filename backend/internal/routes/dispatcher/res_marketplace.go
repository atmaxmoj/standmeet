// res_marketplace.go —— 资源 marketplace:逛 skill 市场(GitHub + SkillsMP)并装一个进来。
//
// 装进来的产物就是一个 skill,所以出站载荷跟 res_skills.go 用**同一个** skillRow ——
// 这正是这两个资源要一起搬的原因:分开搬就会留下两份"一个 skill 长什么样"。
//
// install_manual 只在 admin 面上:它是"把手里的 SKILL.md 粘进来"这个浏览器动作。
// MCP 客户端要造 skill 用 skill_create,不需要粘贴这一步 —— 这是写下来的单面决定,
// 不是漏掉的一个面(Reach 的 Only 就是用来表达这件事的)。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// marketSearchDefaultLimit —— 一页结果。
const marketSearchDefaultLimit = 24

// MarketplaceStore —— marketplace 这组操作所需的最小口。
type MarketplaceStore interface {
	Search(ctx context.Context, in *MarketSearch) ([]MarketSkill, error)
	Install(ctx context.Context, in *InstallSkill) (Skill, error)
	InstallManual(ctx context.Context, ownerID, skillMD, name string) (Skill, error)
}

// MarketSearch —— 搜市场的入参。
type MarketSearch struct {
	Query  string
	Source string
	Limit  int
	Offset int
}

// MarketSkill —— 市场里一条结果的形状。
type MarketSkill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Category    string `json:"category"`
	Description string `json:"description"`
	SourceURL   string `json:"source_url"`
	Source      string `json:"source"`
	Stars       int    `json:"stars"`
}

// InstallSkill —— 从市场装一个 skill 的入参。
type InstallSkill struct {
	OwnerID   string
	Source    string
	ID        string
	SourceURL string
	Name      string
	Version   string
}

// Marketplace —— marketplace 资源:search / install / install_manual。
func Marketplace(store MarketplaceStore) Resource {
	return Resource{Name: "marketplace", Ops: []Op{
		{
			ID: "marketplace.search",
			Description: "Search the skill marketplace (GitHub + SkillsMP directory). " +
				"Returns matching skills with their source, id, name, version, and " +
				"description. Read-only.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"query":{"type":"string","description":"Free-text search query."},
					"source":{"type":"string",
						"description":"Optional filter: 'github' | 'skillsmp' (default all)."},
					"limit":{"type":"integer","description":"Page size (default 24)."},
					"offset":{"type":"integer","description":"Page offset (default 0)."}
				}
			}`),
			Kind:   fp.Read,
			Reach:  fp.OwnerRead(),
			Invoke: marketplaceSearch(store),
		},
		{
			ID: "marketplace.install",
			Description: "Install a marketplace skill by source + id: fetch its SKILL.md " +
				"and persist it as a source='marketplace' owner skill. name/version are " +
				"fallback metadata when the frontmatter omits them.",
			InputSchema: marketInstallSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      marketplaceInstall(store),
		},
		{
			ID: "marketplace.install_manual",
			Description: "Install a SKILL.md the owner pasted in (no marketplace, no " +
				"network). Parses frontmatter + body and persists it as source='manual'.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"skill_md":{"type":"string","description":"The whole SKILL.md text."},
					"name":{"type":"string","description":"Fallback display name."}
				},
				"required":["skill_md"]
			}`),
			Kind: fp.Action,
			Reach: fp.Only(
				"pasting a SKILL.md is a browser affordance; MCP clients compose skills "+
					"with skill_create instead", "admin",
			),
			Invoke: marketplaceInstallManual(store),
		},
	}}
}

var marketInstallSchema = json.RawMessage(`{
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

type marketSearchArgs struct {
	Query  string `json:"query"`
	Source string `json:"source"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

func marketplaceSearch(store MarketplaceStore) Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketSearchArgs
		if err := decodeOptional(raw, &in); err != nil {
			return nil, err
		}
		if in.Limit <= 0 {
			in.Limit = marketSearchDefaultLimit
		}
		items, err := store.Search(ctx, &MarketSearch{
			Query: in.Query, Source: in.Source, Limit: in.Limit, Offset: in.Offset,
		})
		if err != nil {
			return nil, fmt.Errorf("search marketplace: %w", err)
		}
		return marshalOut(items)
	}
}

type marketInstallArgs struct {
	Source    string `json:"source"`
	ID        string `json:"id"`
	SourceURL string `json:"source_url"`
	Name      string `json:"name"`
	Version   string `json:"version"`
}

func marketplaceInstall(store MarketplaceStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketInstallArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.Source == "" || in.ID == "" {
			return nil, BadInput("source and id are required")
		}
		skill, err := store.Install(ctx, &InstallSkill{
			OwnerID: ownerID, Source: in.Source, ID: in.ID,
			SourceURL: in.SourceURL, Name: in.Name, Version: in.Version,
		})
		if err != nil {
			return nil, fmt.Errorf("install skill: %w", err)
		}
		row := toSkillRow(&skill)
		return marshalOut(row)
	}
}

type marketInstallManualArgs struct {
	SkillMD string `json:"skill_md"`
	Name    string `json:"name"`
}

func marketplaceInstallManual(store MarketplaceStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketInstallManualArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		skill, err := store.InstallManual(ctx, ownerID, in.SkillMD, in.Name)
		if err != nil {
			return nil, fmt.Errorf("install manual skill: %w", err)
		}
		row := toSkillRow(&skill)
		return marshalOut(row)
	}
}
