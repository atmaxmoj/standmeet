// Package blockquota — per-code usage limits enforced by declaration. The host side has no
// business vocabulary of its own for this.
//
// A block states three things in its own manifest (plugin.Quota): which config key
// on the code holds the limit, which collection in its own store holds the usage count, and
// which field on those documents records the code. This package reads that and gives two
// answers:
//
//	Allow     — can this session still use it (at the limit → hide the tool, don't error on click)
//	Remaining — how many uses are left (feeds block_state, the frontend just displays it)
//
// **Both answers share the same count.** They used to be two separately-written pieces of code
// in the composition root, and that broke once: #135 removed both hooks together when it
// externalized the booker, then only the gate got added back — Remaining has been nil ever
// since. The frontend contract is still there, nothing feeds it. One count with two outputs
// means you can't accidentally restore only half.
package blockquota

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockconfig"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
)

// Counter — counts usage in this block's own store (bound to its namespace at construction).
type Counter struct {
	store   *blockstore.Store
	cfg     *blockconfig.Store
	decl    *plugin.Quota
	blockID string
	kind    blockstore.Kind
	// subjectFields — the declaration of the fields this block occupies on a subject
	// (the limit is one of them). Code and key share one declaration: the same field mounted
	// on different subjects, not two separate field sets.
	subjectFields []plugin.ConfigField
}

// Bind — everything one binding needs. Packaged as a struct instead of six positional args:
// call sites lose count of which comma is kind and which is blockID, and those two are exactly
// the pair that "can't fill in someone else's form" depends on.
type Bind struct {
	Store   *blockstore.Store
	Config  *blockconfig.Store
	Decl    *plugin.Quota
	BlockID string
	Kind    blockstore.Kind
	// SubjectFields — see Counter.subjectFields.
	SubjectFields []plugin.ConfigField
}

// New — binds a declaration to a block's store. Incomplete / absent declaration → nil
// (this block does not gate on usage).
func New(b *Bind) *Counter {
	if !b.Decl.Usable() {
		return nil
	}
	return &Counter{
		store: b.Store, cfg: b.Config, decl: b.Decl, subjectFields: b.SubjectFields,
		kind: b.Kind, blockID: b.BlockID,
	}
}

// Allow — can this subject use it once more? No subject / no limit → allow. Read failure →
// error (caller decides what to do).
//
// The subject arrives as a **mount point** (`blockconfig.CodeScope(id)` / `KeyScope(id)`): this
// package does not know how many kinds of subject exist, and should not — who it is and where
// it mounts is the composition root's call, since only it sees both sides.
func (c *Counter) Allow(ctx context.Context, subject blockconfig.Scope) (bool, error) {
	left, err := c.Remaining(ctx, subject)
	if err != nil {
		return false, err
	}
	if left == nil {
		return true, nil // nil means unlimited
	}
	return *left > 0, nil
}

// Remaining — how many uses are left. nil = unlimited (or no subject) — **not 0**: 0 would be
// read as "already exhausted".
func (c *Counter) Remaining(ctx context.Context, subject blockconfig.Scope) (*int32, error) {
	limit, err := c.limitOf(ctx, subject)
	if err != nil || limit == nil {
		return nil, err
	}
	used, cerr := c.used(ctx, subject.ID())
	if cerr != nil {
		return nil, cerr
	}
	// Clamp to 0: reporting a negative number when over the limit would read to the frontend as
	// a strange balance.
	left := max(*limit-int32(used), 0)
	return &left, nil
}

// limitOf — the limit on this subject. Unset / null / ≤ 0 → nil (unlimited).
func (c *Counter) limitOf(ctx context.Context, subject blockconfig.Scope) (*int32, error) {
	if subject.ID() == "" {
		return nil, nil //nolint:nilnil // no subject = unlimited, not an error
	}
	values, err := c.cfg.ValuesScoped(ctx, subject, c.subjectFields)
	if err != nil {
		return nil, fmt.Errorf("blockquota limit: %w", err)
	}
	raw, ok := values[c.decl.ConfigKey]
	if !ok {
		return nil, nil //nolint:nilnil // key absent = unlimited
	}
	return decodeLimit(raw)
}

func decodeLimit(raw json.RawMessage) (*int32, error) {
	var limit *int32
	if err := json.Unmarshal(raw, &limit); err != nil {
		return nil, fmt.Errorf("blockquota limit decode: %w", err)
	}
	if limit == nil || *limit <= 0 {
		return nil, nil //nolint:nilnil // null / ≤0 = unlimited
	}
	return limit, nil
}

// used — how many this subject has already used (counts rows in the block's own store).
func (c *Counter) used(ctx context.Context, subjectID string) (int64, error) {
	filter, merr := json.Marshal(map[string]string{c.decl.SubjectField: subjectID})
	if merr != nil {
		return 0, fmt.Errorf("blockquota filter: %w", merr)
	}
	n, cerr := c.store.Count(ctx, c.kind, c.blockID, c.decl.Collection, filter)
	if cerr != nil {
		return 0, fmt.Errorf("blockquota count: %w", cerr)
	}
	return n, nil
}
