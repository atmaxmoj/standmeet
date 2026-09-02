// import_unchanged.go — "did this writing actually change this time".
//
// The corp-tree side has always had this check (`unchangedNode`); the writings side
// never did: finding an existing row meant an unconditional SaveWriting. So importing
// the same vault twice in a row produced a second-run receipt of `0 new · 1 updated`,
// while check 4's pass criterion is "a second import is a no-op — content is preserved,
// not rewritten". The cost was not just a bad number: every import bumped `updated_at`
// on every writing, so "what changed recently" stopped meaning anything (F-L-64).
//
// The check is written as **one fingerprint**, not a chain of `&&`: that way "which
// fields the vault owns" lives in exactly one place, and adding a field means editing
// the struct, not a growing boolean expression.
//
// The conservative side is **saving**: whenever this batch carries attachments or a
// cover-image ref, it still goes through save — those two need to be re-attached, and
// comparing only the scalar fields cannot tell you that.

package obsidian

import corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

// writingFingerprint — the fields the vault has final say over. Two equal
// fingerprints mean this import would change nothing.
type writingFingerprint struct {
	title      string
	body       string
	excerpt    string
	slug       string
	headline   string
	hue        string
	visibility string
	published  bool
}

// unchangedWriting — the existing row matches what this import would write,
// word for word (and there is nothing new to attach).
func unchangedWriting(w *corpus.Writing, in *corpus.SaveWritingInput) bool {
	if len(in.Files) > 0 || in.CoverImageRef != "" {
		return false
	}
	return fingerprintOfWriting(w) == fingerprintOfInput(in) &&
		sameStrings(w.Tags(), in.Tags)
}

func fingerprintOfWriting(w *corpus.Writing) writingFingerprint {
	return writingFingerprint{
		title: w.Title(), body: w.Body(), excerpt: w.Excerpt(), slug: w.Slug(),
		headline: w.CoverHeadline(), hue: w.CoverHue(), visibility: w.VisibilityMode(),
		published: w.IsPublished(),
	}
}

func fingerprintOfInput(in *corpus.SaveWritingInput) writingFingerprint {
	return writingFingerprint{
		title: in.Title, body: in.BodyMD, excerpt: in.Excerpt, slug: in.Slug,
		headline: in.CoverHeadline, hue: in.CoverHue, visibility: in.Visibility,
		published: in.Publish,
	}
}
