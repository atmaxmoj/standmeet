// marketplace.go — browse the skill marketplace (GitHub + SkillsMP) and install
// one.
//
// What gets installed is a skill, so the outbound shape reuses **the same**
// skillOut from skills.go — which is exactly why these two groups belong
// together: keeping them apart would leave two definitions of "what a skill
// looks like".
//
// install_manual lives on the panel only: it's the browser action of "pasting
// in the SKILL.md I already have". An MCP client building a skill uses
// skill_create and skips this pasting step — that's a deliberate single-face
// decision, not a missing face.

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

// marketSearchDefaultLimit — one page of results.
const marketSearchDefaultLimit = 24

// Marketplace — search / install / install_manual.
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
					"with skill_create instead", "admin",
			),
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

// marketSkillOut — the outbound shape of one marketplace search result.
type marketSkillOut struct {
	// RepoStars — the star count of the skill's **repo**; null = this source
	// can't report it. Never default this to 0: that would say "zero stars"
	// when the truth is "unknown" (F-F-2).
	RepoStars   *int   `json:"repo_stars"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Category    string `json:"category"`
	Description string `json:"description"`
	SourceURL   string `json:"source_url"`
	Source      string `json:"source"`
	// Needs — connectors this owner has **not connected yet**, sitting behind
	// the tools this skill wants to use.
	//   null = can't answer (its body was never read, or this instance can't
	//          parse it) — the card says nothing;
	//   []   = can answer, and nothing is missing;
	//   [..] = these are missing.
	// Same rule as repo_stars: never default null to [], that would print
	// "unknown" as "all clear" (F-F-4).
	Needs []string `json:"needs"`
}

type marketSearchArgs struct {
	Query  string `json:"query"`
	Source string `json:"source"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

func searchMarketplace(deps usecase.InstallSkillDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMarketSearch(raw)
		if perr != nil {
			return nil, perr
		}
		items := usecase.SearchMarketplace(ctx,
			usecase.SearchDeps{Client: deps.Marketplace, Connectors: deps.Connectors},
			usecase.SearchParams{
				Query: in.Query, Source: in.Source, OwnerID: ownerID,
				Limit: in.Limit, Offset: in.Offset,
			})
		return json.Marshal(toMarketSkillOut(items))
	}
}

// decodeMarketSearch — every param is optional: an empty body means "browse
// the whole marketplace".
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
			Needs: items[i].Needs,
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

// installErr — categorizes an install failure. Failing to fetch / parse a
// remote SKILL.md is an **external dependency** problem: this message can be
// shown to the owner directly, instead of a generic "internal error".
func installErr(err error) error {
	switch {
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.BadInput("source, id, and a non-empty SKILL.md are required")
	case errors.Is(err, entity.ErrSkillNameTaken):
		return fp.Coded(
			fp.Conflict("a skill with that name is already installed"), "skill_name_taken",
		)
	}
	return fp.Coded(
		fp.Upstream("could not fetch or parse the skill — check the source."), "install_failed",
	)
}
