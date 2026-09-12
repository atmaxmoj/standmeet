// code_config.go — the fields each block occupies on an **access code**, and the usage
// gate that enforces them per declaration.
//
// This replaces three booker-only files (booker_code_config.go / booker_code_store.go /
// booker_quota.go, 294 lines total). None of those three files held any **mechanism** unique
// to booker — storing a per-code value, wiring it into the code-issuing args, gating a tool by
// it, are all generic operations; there was just no generic home for them at the time, so they
// got copied for booker. A second block wanting to put something on a code would have had
// to copy it again.
//
// Now a block only writes two declarations in its own manifest, CodeConfig + Quota, and
// this file knows none of them: it walks the manifests and wires the declarations into the
// generic mechanism.

package blockwire

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockconfig"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockquota"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// CodeFieldSurface — all the fields blocks occupy on a code, merged into the one
// interface access accepts.
//
// Two blocks fighting over the same field name → panic. That's a startup-time factual
// error, not runtime bad luck.
//
//nolint:ireturn // access accepts exactly this interface
func CodeFieldSurface(d *deps.Runtime) access.CodeExtras {
	fields, err := blockconfig.NewCodeFields(d.Log, subjectBlocks(d, "code", codeDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// RoleFieldSurface — all the fields blocks occupy on a role, merged into the one
// interface access accepts.
//
// The only difference from CodeFieldSurface is which declaration it pulls. calendar.book's
// notify_owner was the first one; before it, a per-role toggle could only be born as a column
// on the kernel roles table.
//
//nolint:ireturn // access accepts exactly this interface
func RoleFieldSurface(d *deps.Runtime) access.RoleExtras {
	fields, err := blockconfig.NewRoleFields(d.Log, subjectBlocks(d, "role", roleDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// KeyFieldSurface — all the fields blocks occupy on an **outbound API key**, merged into
// the one interface access accepts.
//
// Uses **the same declaration as a code** (`CodeConfig`): `max_bookings` means "how many times
// this subject may book at most", and that has nothing to do with whether the subject is a code
// or a key. Without this facade a quota attached to a key would have nowhere to be set (F-B-11).
//
//nolint:ireturn // access accepts exactly this interface
func KeyFieldSurface(d *deps.Runtime) access.KeyExtras {
	fields, err := blockconfig.NewKeyFields(d.Log, subjectBlocks(d, "api_key", codeDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// RoleBlockConfig — the read port for reading per-block config when freezing a role
// snapshot (the narrow port on the conversation side). Same declaration, same storage as
// RoleFieldSurface: two shapes, one fact.
func RoleBlockConfig(d *deps.Runtime) *blockconfig.SubjectFields {
	fields, err := blockconfig.NewRoleFields(d.Log, subjectBlocks(d, "role", roleDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

func codeDecl(m *plugin.Manifest) []plugin.ConfigField { return m.CodeConfig }
func roleDecl(m *plugin.Manifest) []plugin.ConfigField { return m.RoleConfig }

// subjectBlocks — the blocks that declare this class of field + each one's own storage.
// Declared but no storage → log one line and skip: that's a startup-time config error, and
// skipping it silently would only leave the owner seeing settings that fail to save.
func subjectBlocks(
	d *deps.Runtime, subject string, decl func(*plugin.Manifest) []plugin.ConfigField,
) []blockconfig.SubjectBlock {
	blocks := []blockconfig.SubjectBlock{}
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		fields := decl(m)
		if len(fields) == 0 {
			continue
		}
		store := BlockStorageOf(d, m)
		if store == nil {
			d.Log.Error("block declares subject fields but has no storage",
				"subject", subject, "block", m.ID)
			continue
		}
		blocks = append(blocks, blockconfig.SubjectBlock{
			Store: BlockConfigFor(store, m.ID), Decl: fields, BlockID: m.ID,
		})
	}
	return blocks
}

// BlockQuotaHooks — every block that declares a Quota gets a pair of hooks: a gate
// (whether to expose the tool) and a remaining count (how many uses are left). **Both share the
// same counter** — they used to be two separately written pieces of code, and only one of the
// two ever got backfilled when the other changed.
func BlockQuotaHooks(d *deps.Runtime, hooks map[string]mount.BlockHooks) {
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		counter := quotaCounterFor(d, m)
		if counter == nil {
			continue
		}
		h := hooks[m.ID]
		h.Gate = quotaGate(counter, d.Log, m.ID)
		h.State = quotaState(counter, m.ID)
		hooks[m.ID] = h
	}
}

func quotaCounterFor(d *deps.Runtime, m *plugin.Manifest) *blockquota.Counter {
	if !m.Quota.Usable() {
		return nil
	}
	store := BlockStorageOf(d, m)
	if store == nil {
		d.Log.Error("block declares a quota but has no storage", "block", m.ID)
		return nil
	}
	return blockquota.New(&blockquota.Bind{
		Store: store, Config: BlockConfigFor(store, m.ID), Decl: &m.Quota,
		// The same field declaration is used for both codes and keys — the limit field itself
		// doesn't care whose subject it's attached to.
		SubjectFields: m.CodeConfig, BlockID: m.ID, Kind: blockstore.KindMCP,
	})
}

// quotaScope — session subject → its config mount point. **This translation can only live at
// the assembly root**: the registry knows "which identity a session runs as", blockconfig knows
// "who config is attached to", and the two packages don't know each other (the architecture gate
// blocks that) — but this file can see both.
//
// No fallback: an unrecognized kind is treated as no subject (not gated). Falling back to a
// default scope would let a misspelled kind silently read someone else's limit — quota is the
// last place that should ever "guess one".
func quotaScope(s registry.Subject) blockconfig.Scope {
	switch s.Kind {
	case registry.SubjectCode:
		return blockconfig.CodeScope(s.ID)
	case registry.SubjectAPIKey:
		return blockconfig.KeyScope(s.ID)
	default:
		return blockconfig.Scope{}
	}
}

// quotaGate — at the limit → this session doesn't expose the tool (hidden, instead of letting
// the visitor click it and then get an error).
//
// Blocking it must **say so**: the symptom of being gated looks identical to "a granted tool
// disappeared" — the same as being unauthorized or having no supplier attached. With no log
// line, whoever investigates has to try each gate one by one.
func quotaGate(
	counter *blockquota.Counter, log *slog.Logger, blockID string,
) registry.SessionGate {
	return func(ctx context.Context, in *registry.AssembleInput) (bool, error) {
		allow, err := counter.Allow(ctx, quotaScope(in.Subject))
		if err != nil {
			log.Warn("block quota check failed — hiding the tool",
				"block", blockID, "subject_kind", in.Subject.Kind,
				"subject", in.Subject.ID, "err", err)
			return false, fmt.Errorf("block %q quota: %w", blockID, err)
		}
		if !allow {
			log.Info("block quota exhausted — tool hidden for this session",
				"block", blockID, "subject_kind", in.Subject.Kind, "subject", in.Subject.ID)
			// Propagate the **reason**. It wraps ErrHidden, so the chat facade still hides
			// it as before; the HTTP facade can ask "why isn't it there" without having to
			// report an exhausted quota as never-authorized (F-B-11).
			return false, registry.ErrQuotaExhausted
		}
		return allow, nil
	}
}

// quotaState — fills the remaining-uses count into block_state.quota_remaining.
// If it can't be read, leave it unset (omitempty) rather than filling in 0: 0 reads as
// "already exhausted".
func quotaState(counter *blockquota.Counter, blockID string) mount.StateHook {
	return func(ctx context.Context, in *registry.AssembleInput) registry.FiberState {
		st := registry.FiberState{ID: blockID, Enabled: true}
		left, err := counter.Remaining(ctx, quotaScope(in.Subject))
		if err != nil {
			return st
		}
		st.QuotaRemaining = left
		return st
	}
}
