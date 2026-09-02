// code_acl.go — narrowing a single code's permissions: three kinds of denial + the
// steering destinations.
//
// There are three kinds of denial (capability / skill / corpus URI); they're three
// dimensions of the same thing: subtracting one more layer from the scope the role
// grants. The three land on two repo method families (a discrete-id family and a
// whole-glob-list family), dispatched by kind; the corpus kind's read-modify-write,
// and waypoints' three-layer merge of "inherited + overridden = effective" — all of
// this is **how the thing is computed**, not how some face presents it, so it lives
// in the domain.
//
// It used to live on the composition root's adapters, so the same operation could be
// computed differently depending on which entry point you came in through.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
)

// The three denial kinds — every face uses the same vocabulary.
const (
	DenialKindCapability = "capability"
	DenialKindSkill      = "skill"
	DenialKindCorpus     = "corpus"
)

// CodeACLDeps — repos needed by this group of permission-narrowing use cases. Roles
// is used to read the half that the role grants.
type CodeACLDeps struct {
	Codes   *repo.CodeRepo
	Denials *repo.CodeDenialRepo
	Roles   *repo.RoleRepo
}

// CodeDenials — a code's three kinds of denial, plus what the role **grants** on
// corpus.
//
// CorpusGranted is included because a revocation list only makes sense read against
// the positive list: the owner needs to judge "what can this code still see", and
// that can't be seen from the revocation list alone.
type CodeDenials struct {
	CapabilityIDs []string
	SkillIDs      []string
	CorpusURIs    []string
	CorpusGranted []string
	// CorpusPublishedOnly — the inherited role reads "whatever the owner has
	// published" (the public identity). That kind of role **has no positive
	// list**, so reading CorpusGranted alone yields "grants nothing" — the
	// exact opposite of the truth.
	CorpusPublishedOnly bool
}

// CodeDenialRef — add/remove one denial. Kind is capability / skill / corpus.
type CodeDenialRef struct {
	OwnerID  string
	CodeID   string
	Kind     string
	TargetID string
}

// ListCodeDenials — reads all three kinds, plus the positive list for comparison.
// **First confirms this code belongs to this owner**.
func ListCodeDenials(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string,
) (CodeDenials, error) {
	if err := ownsCode(ctx, d, ownerID, codeID); err != nil {
		return CodeDenials{}, err
	}
	return listDenials(ctx, d, codeID)
}

// listDenials — the raw read of all three denial kinds. Paths where ownership was
// already confirmed use this, without re-querying the code.
func listDenials(ctx context.Context, d CodeACLDeps, codeID string) (CodeDenials, error) {
	caps, cerr := d.Denials.ListCapabilities(ctx, codeID)
	if cerr != nil {
		return CodeDenials{}, fmt.Errorf("list code denials: %w", cerr)
	}
	skills, serr := d.Denials.ListSkills(ctx, codeID)
	if serr != nil {
		return CodeDenials{}, fmt.Errorf("list code denials: %w", serr)
	}
	uris, uerr := d.Denials.ListCorpusURIs(ctx, codeID)
	if uerr != nil {
		return CodeDenials{}, fmt.Errorf("list code denials: %w", uerr)
	}
	granted, publishedOnly := grantedCorpus(ctx, d, codeID)
	return CodeDenials{
		CapabilityIDs: caps, SkillIDs: skills, CorpusURIs: uris,
		CorpusGranted: granted, CorpusPublishedOnly: publishedOnly,
	}, nil
}

// grantedCorpusURIs — the corpus positive list granted by this code's role. Treated
// as empty when unreadable: it's one half of the comparison, and shouldn't fail the
// whole ACL read.
// grantedCorpus — the corpus scope this code inherits: the role's positive list +
// whether it's the "published slice" kind of identity. Both values are returned
// together because **the list alone can't tell you the scope**: public's list is
// empty, yet it grants everything published.
func grantedCorpus(ctx context.Context, d CodeACLDeps, codeID string) ([]string, bool) {
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return []string{}, false
	}
	role, rerr := d.Roles.GetByID(ctx, code.OwnerID, code.AssumedRoleID)
	if rerr != nil {
		return []string{}, false
	}
	return role.CorpusURIs(), entity.ReadsPublishedSlice(role.Name())
}

// AddCodeDenial — add one. Idempotent.
func AddCodeDenial(
	ctx context.Context, d CodeACLDeps, in *CodeDenialRef,
) (CodeDenials, error) {
	return writeCodeDenial(ctx, d, in, denialAdders(d))
}

// RemoveCodeDenial — revoke one. Idempotent.
func RemoveCodeDenial(
	ctx context.Context, d CodeACLDeps, in *CodeDenialRef,
) (CodeDenials, error) {
	return writeCodeDenial(ctx, d, in, denialRemovers(d))
}

// SetCodeCorpusDenials — replaces the whole revocation list. Doesn't validate glob
// syntax: it's the same language as the role's positive list, and this is pure
// subtraction — a mistake here at worst reads less, never leaks.
func SetCodeCorpusDenials(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string, uris []string,
) (CodeDenials, error) {
	if err := ownsCode(ctx, d, ownerID, codeID); err != nil {
		return CodeDenials{}, err
	}
	if err := d.Denials.SetCorpusURIs(ctx, codeID, uris); err != nil {
		return CodeDenials{}, fmt.Errorf("set corpus denials: %w", err)
	}
	return listDenials(ctx, d, codeID)
}

// denialWrite — writes one denial. Add and remove each have their own table (see
// below), so what's passed down is **the action to take**, not an add bool — a
// boolean control parameter would push the add-vs-remove decision all the way
// down to the innermost layer.
type denialWrite func(ctx context.Context, codeID, target string) error

func denialAdders(d CodeACLDeps) map[string]denialWrite {
	return map[string]denialWrite{
		DenialKindCapability: d.Denials.AddCapability,
		DenialKindSkill:      d.Denials.AddSkill,
		DenialKindCorpus:     addCorpusURI(d),
	}
}

func denialRemovers(d CodeACLDeps) map[string]denialWrite {
	return map[string]denialWrite{
		DenialKindCapability: d.Denials.DeleteCapability,
		DenialKindSkill:      d.Denials.DeleteSkill,
		DenialKindCorpus:     removeCorpusURI(d),
	}
}

// writeCodeDenial — first confirms this code is **this owner's**, then picks that
// kind's write function, writes, and reads back the whole set.
//
// This ownership check used to be missing here: OwnerID was carried in the input,
// but nothing ever looked at it. The result: any code id (even a nonexistent one)
// could have a denial written to it — under multi-tenancy that's an unauthorized
// write to someone else's code. On the ACL's write path, "is this yours" must be
// asked up front, not left to the caller only ever passing its own id.
func writeCodeDenial(
	ctx context.Context, d CodeACLDeps, in *CodeDenialRef, writes map[string]denialWrite,
) (CodeDenials, error) {
	write, ok := writes[in.Kind]
	if !ok {
		return CodeDenials{}, entity.ErrDenialKindUnknown
	}
	if err := ownsCode(ctx, d, in.OwnerID, in.CodeID); err != nil {
		return CodeDenials{}, err
	}
	if err := write(ctx, in.CodeID, in.TargetID); err != nil {
		return CodeDenials{}, fmt.Errorf("write code denial: %w", err)
	}
	return listDenials(ctx, d, in.CodeID)
}

// ownsCode — does this code belong to this owner. "Doesn't exist" and "isn't
// yours" give the **same** answer externally: otherwise this endpoint becomes a
// probe for "does this id exist".
func ownsCode(ctx context.Context, d CodeACLDeps, ownerID, codeID string) error {
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return fmt.Errorf("owns code: %w", err)
	}
	if code.OwnerID != ownerID {
		return entity.ErrCodeInvalid
	}
	return nil
}

// Corpus denials store the whole URI list, so add/remove are both read-modify-write.
func addCorpusURI(d CodeACLDeps) denialWrite {
	return func(ctx context.Context, codeID, uri string) error {
		return rewriteCorpusURIs(ctx, d, codeID, func(cur []string) []string {
			return append(withoutString(cur, uri), uri)
		})
	}
}

func removeCorpusURI(d CodeACLDeps) denialWrite {
	return func(ctx context.Context, codeID, uri string) error {
		return rewriteCorpusURIs(ctx, d, codeID, func(cur []string) []string {
			return withoutString(cur, uri)
		})
	}
}

func rewriteCorpusURIs(
	ctx context.Context, d CodeACLDeps, codeID string, edit func(current []string) []string,
) error {
	current, err := d.Denials.ListCorpusURIs(ctx, codeID)
	if err != nil {
		return fmt.Errorf("rewrite corpus denials: %w", err)
	}
	if serr := d.Denials.SetCorpusURIs(ctx, codeID, edit(current)); serr != nil {
		return fmt.Errorf("rewrite corpus denials: %w", serr)
	}
	return nil
}

func withoutString(xs []string, drop string) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		if x != drop {
			out = append(out, x)
		}
	}
	return out
}

// CodeWaypointsView — the three layers of steering destinations: what the role
// inherits, what this code overrides, and what's effective after the merge.
type CodeWaypointsView struct {
	Inherited []entity.Waypoint
	Overrides []entity.Waypoint
	Effective []entity.Waypoint
}

// CodeWaypoints — reads this code's three layers.
func CodeWaypoints(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string,
) (CodeWaypointsView, error) {
	overrides, err := d.Codes.Waypoints(ctx, codeID)
	if err != nil {
		return CodeWaypointsView{}, fmt.Errorf("read waypoints: %w", err)
	}
	return waypointsView(ctx, d, ownerID, codeID, overrides), nil
}

// SetCodeWaypoints — writes the override layer. Empty list = clear the override,
// falling back to the inherited role's set.
func SetCodeWaypoints(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string, overrides []entity.Waypoint,
) (CodeWaypointsView, error) {
	if err := d.Codes.SetWaypoints(ctx, codeID, overrides); err != nil {
		return CodeWaypointsView{}, fmt.Errorf("set waypoints: %w", err)
	}
	return waypointsView(ctx, d, ownerID, codeID, overrides), nil
}

func waypointsView(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string, overrides []entity.Waypoint,
) CodeWaypointsView {
	inherited := inheritedWaypoints(ctx, d, ownerID, codeID)
	return CodeWaypointsView{
		Inherited: inherited,
		Overrides: overrides,
		Effective: entity.MergeWaypoints(inherited, overrides),
	}
}

// inheritedWaypoints — the set configured on this code's role. Treated as absent
// when unreadable: it's one of three layers, and shouldn't fail the whole read.
func inheritedWaypoints(
	ctx context.Context, d CodeACLDeps, ownerID, codeID string,
) []entity.Waypoint {
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return []entity.Waypoint{}
	}
	role, rerr := d.Roles.GetByID(ctx, ownerID, code.AssumedRoleID)
	if rerr != nil {
		return []entity.Waypoint{}
	}
	return role.Waypoints()
}
