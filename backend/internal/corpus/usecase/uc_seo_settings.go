// uc_seo_settings.go —— 改 owner 全站的对外设置这件事本身。
//
// 底下那条是 upsert,**整行覆写**。于是"调用方没提到的字段"必须先读回当前值填上,
// 否则少发一个字段就等于把它清空。这条规则以前不在域里:面板每次发全量所以看不出来,
// MCP 那条路径不发 site_title —— owner 从 Claude Code 改一下 robots,自己写的站点标题
// 就没了。规则住在域里,哪个入口来都一样。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// SEOSettingsStore —— 改设置需要的最小口(corpus.SEORepo 满足)。
type SEOSettingsStore interface {
	GetSettings(ctx context.Context, ownerID string) (entity.SEOSettings, error)
	UpsertSettings(ctx context.Context, in *entity.SEOSettings) (entity.SEOSettings, error)
}

// SEOSettingsPatch —— 每个字段三态:没提到 = 保持原值,显式空 = 清空。
type SEOSettingsPatch struct {
	OwnerID       string
	SiteTitle     OptionalText
	OGTemplate    OptionalText
	SitemapExtras OptionalTextList
	IndexRobots   OptionalFlag
}

// OptionalText / OptionalFlag / OptionalTextList —— 三态字段。Set=false 表示没提到。
type OptionalText struct {
	Value string
	Set   bool
}

// OptionalFlag —— 三态开关。
type OptionalFlag struct {
	Value bool
	Set   bool
}

// OptionalTextList —— 三态列表。
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

// PatchSEOSettings —— 合并当前值后整行写回。
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
