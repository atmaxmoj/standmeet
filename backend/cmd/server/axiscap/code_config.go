// code_config.go — the fields each capability occupies on an **access code**, and the usage
// gate that enforces them per declaration.
//
// This replaces three booker-only files (booker_code_config.go / booker_code_store.go /
// booker_quota.go, 294 lines total). None of those three files held any **mechanism** unique
// to booker — storing a per-code value, wiring it into the code-issuing args, gating a tool by
// it, are all generic operations; there was just no generic home for them at the time, so they
// got copied for booker. A second capability wanting to put something on a code would have had
// to copy it again.
//
// Now a capability only writes two declarations in its own manifest, CodeConfig + Quota, and
// this file knows none of them: it walks the manifests and wires the declarations into the
// generic mechanism.

package axiscap

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capquota"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// CodeFieldSurface — all the fields capabilities occupy on a code, merged into the one
// interface access accepts.
//
// Two capabilities fighting over the same field name → panic. That's a startup-time factual
// error, not runtime bad luck.
//
//nolint:ireturn // access accepts exactly this interface
func CodeFieldSurface(d *deps.Runtime) access.CodeExtras {
	fields, err := capconfig.NewCodeFields(d.Log, subjectCaps(d, "code", codeDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// RoleFieldSurface — all the fields capabilities occupy on a role, merged into the one
// interface access accepts.
//
// The only difference from CodeFieldSurface is which declaration it pulls. calendar.book's
// notify_owner was the first one; before it, a per-role toggle could only be born as a column
// on the kernel roles table.
//
//nolint:ireturn // access accepts exactly this interface
func RoleFieldSurface(d *deps.Runtime) access.RoleExtras {
	fields, err := capconfig.NewRoleFields(d.Log, subjectCaps(d, "role", roleDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// KeyFieldSurface — all the fields capabilities occupy on an **outbound API key**, merged into
// the one interface access accepts.
//
// Uses **the same declaration as a code** (`CodeConfig`): `max_bookings` means "how many times
// this subject may book at most", and that has nothing to do with whether the subject is a code
// or a key. Without this facade a quota attached to a key would have nowhere to be set (F-B-11).
//
//nolint:ireturn // access accepts exactly this interface
func KeyFieldSurface(d *deps.Runtime) access.KeyExtras {
	fields, err := capconfig.NewKeyFields(d.Log, subjectCaps(d, "api_key", codeDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

// RoleCapConfig — the read port for reading per-capability config when freezing a role
// snapshot (the narrow port on the conversation side). Same declaration, same storage as
// RoleFieldSurface: two shapes, one fact.
func RoleCapConfig(d *deps.Runtime) *capconfig.SubjectFields {
	fields, err := capconfig.NewRoleFields(d.Log, subjectCaps(d, "role", roleDecl))
	if err != nil {
		panic(err)
	}
	return fields
}

func codeDecl(m *mcpplugin.Manifest) []mcpplugin.ConfigField { return m.CodeConfig }
func roleDecl(m *mcpplugin.Manifest) []mcpplugin.ConfigField { return m.RoleConfig }

// subjectCaps — the capabilities that declare this class of field + each one's own storage.
// Declared but no storage → log one line and skip: that's a startup-time config error, and
// skipping it silently would only leave the owner seeing settings that fail to save.
func subjectCaps(
	d *deps.Runtime, subject string, decl func(*mcpplugin.Manifest) []mcpplugin.ConfigField,
) []capconfig.SubjectCap {
	caps := []capconfig.SubjectCap{}
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		fields := decl(m)
		if len(fields) == 0 {
			continue
		}
		store := CapabilityStorage(d, m)
		if store == nil {
			d.Log.Error("capability declares subject fields but has no storage",
				"subject", subject, "cap", m.ID)
			continue
		}
		caps = append(caps, capconfig.SubjectCap{
			Store: CapConfigFor(store, m.ID), Decl: fields, CapID: m.ID,
		})
	}
	return caps
}

// CapabilityQuotaHooks — every capability that declares a Quota gets a pair of hooks: a gate
// (whether to expose the tool) and a remaining count (how many uses are left). **Both share the
// same counter** — they used to be two separately written pieces of code, and only one of the
// two ever got backfilled when the other changed.
func CapabilityQuotaHooks(d *deps.Runtime, hooks map[string]capload.CapHooks) {
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

func quotaCounterFor(d *deps.Runtime, m *mcpplugin.Manifest) *capquota.Counter {
	if !m.Quota.Usable() {
		return nil
	}
	store := CapabilityStorage(d, m)
	if store == nil {
		d.Log.Error("capability declares a quota but has no storage", "cap", m.ID)
		return nil
	}
	return capquota.New(&capquota.Bind{
		Store: store, Config: CapConfigFor(store, m.ID), Decl: m.Quota,
		// The same field declaration is used for both codes and keys — the cap field itself
		// doesn't care whose subject it's attached to.
		SubjectFields: m.CodeConfig, CapID: m.ID, Kind: capstore.KindMCP,
	})
}

// quotaScope — session subject → its config mount point. **This translation can only live at
// the assembly root**: capreg knows "which identity a session runs as", capconfig knows "who
// config is attached to", and the two packages don't know each other (the architecture gate
// blocks that) — but this file can see both.
//
// No fallback: an unrecognized kind is treated as no subject (not gated). Falling back to a
// default scope would let a misspelled kind silently read someone else's cap — quota is the
// last place that should ever "guess one".
func quotaScope(s capreg.Subject) capconfig.Scope {
	switch s.Kind {
	case capreg.SubjectCode:
		return capconfig.CodeScope(s.ID)
	case capreg.SubjectAPIKey:
		return capconfig.KeyScope(s.ID)
	default:
		return capconfig.Scope{}
	}
}

// quotaGate — at the cap → this session doesn't expose the tool (hidden, instead of letting
// the visitor click it and then get an error).
//
// Blocking it must **say so**: the symptom of being gated looks identical to "a granted tool
// disappeared" — the same as being unauthorized or having no connector attached. With no log
// line, whoever investigates has to try each gate one by one.
func quotaGate(counter *capquota.Counter, log *slog.Logger, capID string) capreg.SessionGate {
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		allow, err := counter.Allow(ctx, quotaScope(in.Subject))
		if err != nil {
			log.Warn("capability quota check failed — hiding the tool",
				"cap", capID, "subject_kind", in.Subject.Kind,
				"subject", in.Subject.ID, "err", err)
			return false, fmt.Errorf("capability %q quota: %w", capID, err)
		}
		if !allow {
			log.Info("capability quota exhausted — tool hidden for this session",
				"cap", capID, "subject_kind", in.Subject.Kind, "subject", in.Subject.ID)
			// Propagate the **reason**. It wraps ErrHidden, so the chat facade still hides
			// it as before; the HTTP facade can ask "why isn't it there" without having to
			// report an exhausted quota as never-authorized (F-B-11).
			return false, capreg.ErrQuotaExhausted
		}
		return allow, nil
	}
}

// quotaState — fills the remaining-uses count into capability_state.quota_remaining.
// If it can't be read, leave it unset (omitempty) rather than filling in 0: 0 reads as
// "already exhausted".
func quotaState(counter *capquota.Counter, capID string) capload.StateHook {
	return func(ctx context.Context, in *capreg.AssembleInput) capreg.CapabilityState {
		st := capreg.CapabilityState{ID: capID, Enabled: true}
		left, err := counter.Remaining(ctx, quotaScope(in.Subject))
		if err != nil {
			return st
		}
		st.QuotaRemaining = left
		return st
	}
}
