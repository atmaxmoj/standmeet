// marketplace.go —— skill marketplace search usecase. Thin wrapper
// around marketplace.Client so the admin REST layer doesn't reach
// directly into the marketplace package (arch-lint convention).
//
// Install + SKILL.md fetch land in a later phase; this surface is
// search-only.

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// MarketplaceClient —— matches marketplace.Client. Interfaces lets us
// stub the network out in usecase-level tests.
type MarketplaceClient interface {
	Search(ctx context.Context, query, source string) []domain.MarketSkill
	FetchSkillContent(
		ctx context.Context, source domain.MarketSource, id string,
	) (domain.MarketSkillContent, error)
}

// MarketplaceDeps —— bundle for the marketplace search REST route.
type MarketplaceDeps struct {
	Client MarketplaceClient
}

// SearchMarketplace —— delegates to the injected client. The caller
// translates HTTP query params into (query, source); we don't validate
// `source` here because the client falls back to "all" on unknown
// values.
func SearchMarketplace(
	ctx context.Context, deps MarketplaceDeps, query, source string,
) []domain.MarketSkill {
	return deps.Client.Search(ctx, query, source)
}

// InstallSkillDeps —— #48-3: install fetches the SKILL.md via the client and
// persists it as a real skill.
type InstallSkillDeps struct {
	Marketplace MarketplaceClient
	Skills      *postgres.SkillRepo
}

// InstallSkillInput —— what the admin install endpoint passes through.
type InstallSkillInput struct {
	OwnerID string
	Source  string // "github" | "skillsmp"
	ID      string // market skill id (github dir name / skillsmp id)
	Name    string // fallback display name when frontmatter has none
	Version string
}

// InstallSkill —— fetch + parse a market skill's SKILL.md, persist it as a
// source='marketplace' skill. frontmatter name/description/allowed-tools win;
// the search metadata (name/version) is fallback. Empty body → ErrEmptyField.
func InstallSkill(
	ctx context.Context, deps InstallSkillDeps, in *InstallSkillInput,
) (domain.Skill, error) {
	if !validInstallInput(in) {
		return domain.Skill{}, ErrEmptyField
	}
	content, err := deps.Marketplace.FetchSkillContent(
		ctx, domain.MarketSource(in.Source), in.ID,
	)
	if err != nil {
		return domain.Skill{}, fmt.Errorf("fetch skill content: %w", err)
	}
	if strings.TrimSpace(content.Prompt) == "" {
		return domain.Skill{}, ErrEmptyField
	}
	return createInstalledSkill(ctx, deps, in, &content)
}

func validInstallInput(in *InstallSkillInput) bool {
	return in.OwnerID != "" && in.ID != "" && in.Source != ""
}

func createInstalledSkill(
	ctx context.Context, deps InstallSkillDeps,
	in *InstallSkillInput, content *domain.MarketSkillContent,
) (domain.Skill, error) {
	skill, cerr := deps.Skills.Create(ctx, &postgres.CreateSkillInput{
		OwnerID:      in.OwnerID,
		Name:         firstNonEmptyStr(content.Name, in.Name, in.ID),
		Description:  content.Description,
		Prompt:       content.Prompt,
		AllowedTools: content.AllowedTools,
		Source:       "marketplace",
		Version:      in.Version,
	})
	if cerr != nil {
		if errors.Is(cerr, domain.ErrSkillNameTaken) {
			return domain.Skill{}, domain.ErrSkillNameTaken
		}
		return domain.Skill{}, fmt.Errorf("create installed skill: %w", cerr)
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
