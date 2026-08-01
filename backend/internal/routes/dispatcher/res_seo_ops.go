// res_seo_ops.go —— seo 资源的解参 / 调用 / 序列化(声明在 res_seo.go)。

package dispatcher

import (
	"context"
	"encoding/json"
)

// seoSettingsOut / seoStatsOut / seoEntryOut —— 出站载荷(两个面同一份)。
type seoSettingsOut struct {
	SiteTitle     string   `json:"site_title"`
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

type seoStatsOut struct {
	Wiki     int64 `json:"wiki"`
	Outputs  int64 `json:"outputs"`
	Writings int64 `json:"writings"`
}

type seoEntryOut struct {
	ID      string `json:"id"`
	Genre   string `json:"genre"`
	Excerpt string `json:"excerpt"`
	// UnpinnedSections —— 取消公开时自动摘掉的主页栏目(空 = 本来就没 pin)。
	UnpinnedSections []string `json:"unpinned_sections"`
	Published        bool     `json:"published"`
}

func toSEOSettingsOut(s *SEOSettings) seoSettingsOut {
	return seoSettingsOut{
		SiteTitle: s.SiteTitle, OGTemplate: s.OGTemplate,
		SitemapExtras: nonNilStrings(s.SitemapExtras), IndexRobots: s.IndexRobots,
	}
}

func seoGetSettings(store SEOStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		s, err := store.Settings(ctx, ownerID)
		if err != nil {
			return nil, opErr("read settings", err)
		}
		return marshalOut(toSEOSettingsOut(&s))
	}
}

type seoSettingsArgs struct {
	SiteTitle     OptionalString  `json:"site_title"`
	OGTemplate    OptionalString  `json:"og_template"`
	SitemapExtras OptionalStrings `json:"sitemap_extras"`
	IndexRobots   OptionalBool    `json:"index_robots"`
}

func seoUpdateSettings(store SEOStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in seoSettingsArgs
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &in); err != nil {
				return nil, BadInput("invalid arguments: " + err.Error())
			}
		}
		s, err := store.SaveSettings(ctx, &UpdateSEOSettings{
			OwnerID: ownerID, SiteTitle: in.SiteTitle, OGTemplate: in.OGTemplate,
			SitemapExtras: in.SitemapExtras, IndexRobots: in.IndexRobots,
		})
		if err != nil {
			return nil, opErr("save settings", err)
		}
		return marshalOut(toSEOSettingsOut(&s))
	}
}

func seoStats(store SEOStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		st, err := store.Stats(ctx, ownerID)
		if err != nil {
			return nil, opErr("count published", err)
		}
		return marshalOut(seoStatsOut(st))
	}
}

type seoEntryArgs struct {
	Genre     string `json:"genre"`
	ID        string `json:"id"`
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

func (a seoEntryArgs) validate() error {
	if a.ID == "" {
		return BadInput("id is required")
	}
	if a.Genre != SEOGenreWiki && a.Genre != SEOGenreOutput {
		return BadInput("genre must be wiki or output")
	}
	return nil
}

func seoSetEntry(store SEOStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in seoEntryArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if err := in.validate(); err != nil {
			return nil, err
		}
		res, err := store.SetEntrySEO(ctx, &EntrySEO{
			OwnerID: ownerID, Genre: in.Genre, EntryID: in.ID,
			Excerpt: in.Excerpt, Published: in.Published,
		})
		if err != nil {
			return nil, opErr("set entry seo", err)
		}
		return marshalOut(seoEntryOut{
			ID: res.ID, Genre: res.Genre, Excerpt: res.Excerpt,
			Published: res.Published, UnpinnedSections: nonNilStrings(res.Unpinned),
		})
	}
}
