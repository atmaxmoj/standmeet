// cover.go —— Writing's cover sub-object. Wiki / Output / Raw have no cover concept.
//
// Cover is a compact unit: headline + hue (color preset) + imageAssetID
// (optional uploaded image). The subtitle isn't here — it's the writing's
// excerpt (the card excerpt / og / cover subtitle all share that one field, see
// writing.Excerpt). The frontend's /writings/<slug> hero and the /writings
// index lead card each render Cover independently.

package entity

// CoverHue —— the three built-in design-system hues, aligned to the
// vermillion-paper-ink palette. The frontend dispatches a different CSS
// variable per hue.
const (
	CoverHueAmber  = "amber"
	CoverHueViolet = "violet"
	CoverHueAcid   = "acid"
)

// Cover —— Writing's cover field set.
type Cover struct {
	headline     string
	hue          string
	imageAssetID string // empty string = no cover image set (typographic-only)
}

// CoverInit —— constructor params.
type CoverInit struct {
	Headline     string
	Hue          string
	ImageAssetID string
}

// NewCover —— constructs a Cover from Init. Hue outside {amber, violet, acid}
// falls back to amber (matches the frontend's fallback).
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

// Headline —— the large cover headline (serif, design system's large size).
func (c Cover) Headline() string { return c.headline }

// Hue —— one of the three hues, always normalized.
func (c Cover) Hue() string { return c.hue }

// ImageAssetID —— the asset id of the uploaded cover image. Empty string = none
// set. Callers typically check with `if id := c.ImageAssetID(); id != "" { ... }`.
func (c Cover) ImageAssetID() string { return c.imageAssetID }

// HasImage —— whether a cover image is set. The semantic version of
// ImageAssetID() != "".
func (c Cover) HasImage() bool { return c.imageAssetID != "" }
