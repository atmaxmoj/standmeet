// page_owner_view.go — the home page as the owner sees it.
//
// There's only one difference from the visitor's version (PageContentView), but it
// matters: each section carries both the **id list** and the joined **cards**.
//
//   - The ids are what the owner edits — read them back, tweak, save again, same field
//     name in and out, no translation needed.
//   - The cards are what the owner's AI wants to see — "what does this pin point to,
//     what does it say".
//
// These two halves used to be split across two surfaces: the panel got bare ids, MCP got
// cards. The same home page looked like two different things to the two sides, and
// neither side could save back what the other one had.

package usecase

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// OwnerPageView — the home page payload for the owner surface.
type OwnerPageView struct {
	UpdatedAt    time.Time            `json:"updated_at"`
	Where        entity.PageWhere     `json:"where"`
	Contact      entity.PageContact   `json:"contact"`
	OwnerID      string               `json:"owner_id"`
	HeroProse    string               `json:"hero_prose"`
	HeroExamples []string             `json:"hero_examples"`
	Insights     []string             `json:"insights"`
	Projects     []string             `json:"projects"`
	InsightCards []entity.PagePinCard `json:"insight_cards"`
	ProjectCards []entity.PagePinCard `json:"project_cards"`
}

// BuildOwnerPageView — storage shape -> owner-surface payload (ids + joined cards).
func BuildOwnerPageView(
	ctx context.Context, deps PageDeps, ownerID string, content *entity.PageContent,
) (OwnerPageView, error) {
	view, err := BuildPageContentView(ctx, deps, ownerID, content)
	if err != nil {
		return OwnerPageView{}, err
	}
	return OwnerPageView{
		UpdatedAt: content.UpdatedAt, Where: content.Where, Contact: content.Contact,
		OwnerID: content.OwnerID, HeroProse: content.HeroProse,
		HeroExamples: nonNilList(content.HeroExamples),
		Insights:     nonNilList(content.Insights),
		Projects:     nonNilList(content.Projects),
		InsightCards: view.Insights,
		ProjectCards: view.Projects,
	}, nil
}

func nonNilList(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}
