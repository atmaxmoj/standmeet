// visibility.go —— Writing's visibility sub-object.
//
// Visibility determines the shape a visitor (no code, or a mismatched code)
// sees a writing in:
//   - Public: body_md is fully open
//   - Private: the frontend renders only the LockedBody field as a teaser,
//     body_md is not returned
//
// Real access control goes through the corpus URI ACL from
// [[iam-role-pivot-plan]] (A.3-IAM implementation); Visibility here is only a
// "how the frontend should render" hint.

package entity

// VisibilityMode —— visibility mode enum. Only two tiers pre-launch; can extend
// to unlisted / timed-release etc. later.
const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

// Visibility —— Writing's visibility + the teaser text shown while locked.
type Visibility struct {
	mode       string
	lockedBody string // the teaser shown to visitors when private
}

// VisibilityInit —— constructor params.
type VisibilityInit struct {
	Mode       string
	LockedBody string
}

// NewVisibility —— constructs from Init; Mode outside the allowlist falls back
// to public.
func NewVisibility(i *VisibilityInit) Visibility {
	return Visibility{
		mode:       normalizeMode(i.Mode),
		lockedBody: i.LockedBody,
	}
}

func normalizeMode(m string) string {
	if m == VisibilityPrivate {
		return VisibilityPrivate
	}
	return VisibilityPublic
}

// Mode —— the visibility mode string (public / private).
func (v Visibility) Mode() string { return v.mode }

// LockedBody —— the teaser shown in private mode; meaningless when public.
func (v Visibility) LockedBody() string { return v.lockedBody }

// IsPublic —— whether it's in public mode.
func (v Visibility) IsPublic() bool { return v.mode == VisibilityPublic }

// IsPrivate —— whether it's in private mode.
func (v Visibility) IsPrivate() bool { return v.mode == VisibilityPrivate }
