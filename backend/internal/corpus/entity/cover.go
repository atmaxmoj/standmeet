// cover.go —— Writing 的封面 sub-object。Wiki / Output / Raw 没有封面概念。
//
// Cover 是个紧凑的 unit：headline + hue (color preset) + imageAssetID
// (optional uploaded image)。副标题不在此——它就是 writing 的 excerpt（卡片
// excerpt / og / cover 副标题共用一个字段，见 writing.Excerpt）。前端
// /writings/<slug> hero 和 /writings index lead card 各自渲染 Cover。

package entity

// CoverHue —— 三种 design 系内置色调，design 系统对齐 vermillion-paper-ink
// palette。前端按 hue dispatch 不同 CSS variable。
const (
	CoverHueAmber  = "amber"
	CoverHueViolet = "violet"
	CoverHueAcid   = "acid"
)

// Cover —— Writing 的封面字段集。
type Cover struct {
	headline     string
	hue          string
	imageAssetID string // 空字符串 = 没传 cover 图（走 typographic-only）
}

// CoverInit —— 构造参数。
type CoverInit struct {
	Headline     string
	Hue          string
	ImageAssetID string
}

// NewCover —— 从 Init 构造 Cover。Hue 不在 {amber, violet, acid} → fallback
// amber (跟前端 fallback 一致)。
func NewCover(i *CoverInit) Cover {
	return Cover{
		headline:     i.Headline,
		hue:          normalizeHue(i.Hue),
		imageAssetID: i.ImageAssetID,
	}
}

func normalizeHue(h string) string {
	switch h {
	case CoverHueAmber, CoverHueViolet, CoverHueAcid:
		return h
	}
	return CoverHueAmber
}

// Headline —— 封面大标题（serif，design 系大字号）。
func (c Cover) Headline() string { return c.headline }

// Hue —— 三种色调之一，永远 normalize 过。
func (c Cover) Hue() string { return c.hue }

// ImageAssetID —— 已上传 cover 图的 asset id。空字符串 = 没传。
// caller 通常 `if id := c.ImageAssetID(); id != "" { ... }` 判断。
func (c Cover) ImageAssetID() string { return c.imageAssetID }

// HasImage —— 是否设了 cover 图。语义版的 ImageAssetID() != ""。
func (c Cover) HasImage() bool { return c.imageAssetID != "" }
