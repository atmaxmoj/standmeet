// marketplace.go —— skill marketplace search usecase. Thin wrapper
// around marketplace.Client so the admin REST layer doesn't reach
// directly into the marketplace package (arch-lint convention).
//
// Install + SKILL.md fetch shipped (#48-3): InstallSkill / InstallManualSkill live in this same
// file. This is no longer search-only.

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/marketplace"
)

// MarketplaceClient —— matches marketplace.Client. Interfaces lets us
// stub the network out in usecase-level tests.
type MarketplaceClient interface {
	Search(ctx context.Context, query, source string) []marketplace.MarketSkill
	FetchSkillContent(
		ctx context.Context, source marketplace.MarketSource, id, sourceURL string,
	) (marketplace.MarketSkillContent, error)
	// ParseSkillMD parses raw SKILL.md (no network) for manual install.
	ParseSkillMD(raw string) marketplace.MarketSkillContent
}

// MarketplaceDeps —— bundle for the marketplace search REST route.
type MarketplaceDeps struct {
	Client MarketplaceClient
}

// MarketSearchParams —— search query + source + page window.
type MarketSearchParams struct {
	Query  string
	Source string
	Limit  int
	Offset int
}

// SearchMarketplace —— delegates to the injected client, then returns one
// page [offset, offset+limit). The client aggregates all of GitHub + SkillsMP
// (cheap, cached directory); pagination is presentation-level slicing so the
// marketplace tab can "load more". `source` isn't validated here — the client
// falls back to "all" on unknown values.
func SearchMarketplace(
	ctx context.Context, deps MarketplaceDeps, p MarketSearchParams,
) []marketplace.MarketSkill {
	return pageSlice(deps.Client.Search(ctx, p.Query, p.Source), p.Limit, p.Offset)
}

func pageSlice(items []marketplace.MarketSkill, limit, offset int) []marketplace.MarketSkill {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(items) {
		return []marketplace.MarketSkill{}
	}
	end := offset + limit
	if limit <= 0 || end > len(items) {
		end = len(items)
	}
	return items[offset:end]
}

// InstallSkillDeps —— #48-3: install fetches the SKILL.md via the client and
// persists it as a real skill.
type InstallSkillDeps struct {
	Marketplace MarketplaceClient
	Skills      *marketplace.SkillRepo
}

// InstallSkillInput —— what the admin install endpoint passes through.
type InstallSkillInput struct {
	OwnerID   string
	Source    string // "github" | "skillsmp"
	ID        string // market skill id (github dir name / skillsmp id)
	SourceURL string // skill's githubUrl — SkillsMP install fetches the SKILL.md from it
	Name      string // fallback display name when frontmatter has none
	Version   string
}

// InstallSkill —— fetch + parse a market skill's SKILL.md, persist it as a
// source='marketplace' skill. frontmatter name/description/allowed-tools win;
// the search metadata (name/version) is fallback. Empty body → ErrEmptyField.
func InstallSkill(
	ctx context.Context, deps InstallSkillDeps, in *InstallSkillInput,
) (marketplace.Skill, error) {
	if !validInstallInput(in) {
		return marketplace.Skill{}, ErrEmptyField
	}
	content, err := deps.Marketplace.FetchSkillContent(
		ctx, marketplace.MarketSource(in.Source), in.ID, in.SourceURL,
	)
	if err != nil {
		return marketplace.Skill{}, fmt.Errorf("fetch skill content: %w", err)
	}
	if strings.TrimSpace(content.Prompt) == "" {
		return marketplace.Skill{}, ErrEmptyField
	}
	return createInstalledSkill(ctx, deps, in, &content)
}

func validInstallInput(in *InstallSkillInput) bool {
	return in.OwnerID != "" && in.ID != "" && in.Source != ""
}

// InstallManualSkill —— install a SKILL.md the owner pasted/uploaded from anywhere (no
// marketplace, no network): parse the frontmatter + body, persist as a source='manual'
// skill. Empty owner / empty body → ErrEmptyField.
func InstallManualSkill(
	ctx context.Context, deps InstallSkillDeps, ownerID, skillMD, nameFallback string,
) (marketplace.Skill, error) {
	if ownerID == "" || strings.TrimSpace(skillMD) == "" {
		return marketplace.Skill{}, ErrEmptyField
	}
	content := deps.Marketplace.ParseSkillMD(skillMD)
	if strings.TrimSpace(content.Prompt) == "" {
		return marketplace.Skill{}, ErrEmptyField
	}
	return persistManualSkill(ctx, deps, ownerID, nameFallback, &content)
}

func persistManualSkill(
	ctx context.Context, deps InstallSkillDeps,
	ownerID, nameFallback string, content *marketplace.MarketSkillContent,
) (marketplace.Skill, error) {
	skill, cerr := deps.Skills.Create(ctx, &marketplace.CreateSkillInput{
		OwnerID:      ownerID,
		Name:         firstNonEmptyStr(content.Name, nameFallback),
		Description:  content.Description,
		Prompt:       content.Prompt,
		AllowedTools: content.AllowedTools,
		Source:       "manual",
		Version:      content.Version,
	})
	if cerr != nil {
		if errors.Is(cerr, marketplace.ErrSkillNameTaken) {
			return marketplace.Skill{}, marketplace.ErrSkillNameTaken
		}
		return marketplace.Skill{}, fmt.Errorf("create manual skill: %w", cerr)
	}
	return skill, nil
}

func createInstalledSkill(
	ctx context.Context, deps InstallSkillDeps,
	in *InstallSkillInput, content *marketplace.MarketSkillContent,
) (marketplace.Skill, error) {
	skill, cerr := deps.Skills.Create(ctx, &marketplace.CreateSkillInput{
		OwnerID:      in.OwnerID,
		Name:         firstNonEmptyStr(content.Name, in.Name, in.ID),
		Description:  content.Description,
		Prompt:       content.Prompt,
		AllowedTools: content.AllowedTools,
		Source:       "marketplace",
		Version:      in.Version,
	})
	if cerr != nil {
		if errors.Is(cerr, marketplace.ErrSkillNameTaken) {
			return marketplace.Skill{}, marketplace.ErrSkillNameTaken
		}
		return marketplace.Skill{}, fmt.Errorf("create installed skill: %w", cerr)
	}
	return skill, nil
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
