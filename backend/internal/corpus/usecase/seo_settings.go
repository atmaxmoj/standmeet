// seo_settings.go — the act of changing the owner's site-wide outward-facing settings.
//
// The op below is an upsert that **overwrites the whole row**. So any field the caller
// didn't mention must be read back from the current value first — otherwise omitting a
// field is the same as clearing it. This rule used to live outside the domain: the admin
// panel always sends the full set so the gap never showed, but the MCP path doesn't send
// site_title — the owner tweaks robots from Claude Code and their own hand-written site
// title disappears. The rule now lives in the domain, so every entry point gets it alike.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// SEOSettingsStore — the minimal port needed to change settings (corpus.SEORepo satisfies it).
type SEOSettingsStore interface {
	GetSettings(ctx context.Context, ownerID string) (entity.SEOSettings, error)
	UpsertSettings(ctx context.Context, in *entity.SEOSettings) (entity.SEOSettings, error)
}

// SEOSettingsPatch — each field is tri-state: unmentioned = keep current value, explicit
// empty = clear.
type SEOSettingsPatch struct {
	OwnerID       string
	SiteTitle     OptionalText
	OGTemplate    OptionalText
	SitemapExtras OptionalTextList
	IndexRobots   OptionalFlag
}

// OptionalText / OptionalFlag / OptionalTextList — tri-state fields. Set=false means unmentioned.
type OptionalText struct {
	Value string
	Set   bool
}

// OptionalFlag — a tri-state toggle.
type OptionalFlag struct {
	Value bool
	Set   bool
}

// OptionalTextList — a tri-state list.
type OptionalTextList struct {
	Value []string
	Set   bool
}

func (o OptionalText) or(current string) string {
	if o.Set {
		return o.Value
	}
	return current
}

func (o OptionalFlag) or(current bool) bool {
	if o.Set {
		return o.Value
	}
	return current
}

func (o OptionalTextList) or(current []string) []string {
	if o.Set {
		return o.Value
	}
	return current
}

// PatchSEOSettings — merges onto the current value, then writes the whole row back.
func PatchSEOSettings(
	ctx context.Context, store SEOSettingsStore, in *SEOSettingsPatch,
) (entity.SEOSettings, error) {
	cur, err := store.GetSettings(ctx, in.OwnerID)
	if err != nil {
		return entity.SEOSettings{}, fmt.Errorf("read seo settings: %w", err)
	}
	saved, serr := store.UpsertSettings(ctx, &entity.SEOSettings{
		OwnerID:       in.OwnerID,
		SiteTitle:     in.SiteTitle.or(cur.SiteTitle),
		IndexRobots:   in.IndexRobots.or(cur.IndexRobots),
		SitemapExtras: in.SitemapExtras.or(cur.SitemapExtras),
		OGTemplate:    in.OGTemplate.or(cur.OGTemplate),
	})
	if serr != nil {
		return entity.SEOSettings{}, fmt.Errorf("save seo settings: %w", serr)
	}
	return saved, nil
}
