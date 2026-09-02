// Package capconfig — a capability's configurable fields: **generic**
// storage and retrieval where the host doesn't know the meaning of any field.
//
// A capability declares which config fields it has in its own manifest
// (mcpplugin.ConfigField: key, type, default), the owner fills them in on the
// panel, and the values are stored in **this capability's own isolated
// storage** (a fixed collection in capstore). Reads fall back to the
// declared default.
//
// The host side never contains a single business word — no "working_hours",
// no "booking". It only knows "this capability declared a set of keys, and the
// owner overrode some of them."
//
// Why this package exists: before it, a capability that wanted to be
// "configurable" had no path — the host had to hand-write the whole thing:
// entity, default, read/write, routing, form. A hand-written copy inevitably
// drifts (booker's policy had already drifted: the host said 18:00 with a
// 15-minute buffer, the sandbox parsed 17:00 with a 0 buffer). This is the
// same hole as the earlier OwnerTools patch.
package capconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// Store — a config read/write handle **bound to one capability**.
//
// The collection name is fixed rather than each capability picking its own:
// the host needs to be able to read/write it generically (see scope.go).
//
// (kind, capID) is fixed at construction time — the same shape as capstore's
// BoundStore: the handle a caller gets can only operate on this one
// capability's config, and can't be filled in with someone else's id.
type Store struct {
	store *capstore.Store
	kind  capstore.Kind
	capID string
}

// New — binds the underlying capstore to one capability's namespace.
func New(store *capstore.Store, kind capstore.Kind, capID string) *Store {
	return &Store{store: store, kind: kind, capID: capID}
}

// Field — a config field's **declaration + current value**, one row the panel
// renders from.
type Field struct {
	Key         string
	Label       string
	Type        string
	Description string
	// Value — the value currently in effect (JSON literal). If the owner never
	// set it, this is the declared default.
	Value string
	// Default — the declared default (JSON literal); the panel uses this to
	// show a "restore default" option.
	Default string
	// Overridden — whether the owner explicitly set this. false = currently
	// using the default.
	Overridden bool
}

// Get — all of a capability's current config fields under one owner
// (declaration ∪ owner overrides).
func (s *Store) Get(
	ctx context.Context, ownerID string, decl []mcpplugin.ConfigField,
) ([]Field, error) {
	return s.GetScoped(ctx, OwnerScope(ownerID), decl)
}

// GetScoped — all of a capability's current config fields at one attachment
// point (declaration ∪ overrides).
//
// The **declaration** is authoritative: a key not in the declaration is never
// returned even if a value was stored for it — after a capability removes a
// config field, the old value shouldn't keep surfacing on the panel.
func (s *Store) GetScoped(
	ctx context.Context, scope Scope, decl []mcpplugin.ConfigField,
) ([]Field, error) {
	stored, err := s.stored(ctx, scope)
	if err != nil {
		return nil, err
	}
	out := make([]Field, 0, len(decl))
	for i := range decl {
		def := defaultOf(&decl[i])
		f := Field{
			Key: decl[i].Key, Label: decl[i].Label, Type: decl[i].Type,
			Description: decl[i].Description, Default: def, Value: def,
		}
		if v, ok := stored[decl[i].Key]; ok {
			f.Value, f.Overridden = string(v), true
		}
		out = append(out, f)
	}
	return out, nil
}

// defaultOf — for a field with no declared default, the default is JSON
// null, **not an empty string**.
//
// An empty string isn't a valid JSON literal: whoever decodes it gets
// "unexpected end of input," and that error reads as "this config is broken."
// The truth is "this was never set." A declaration with no default shouldn't
// turn every read path into a failure — it just has no value.
//
// This hole really did bite: booker's per-code quota had no declared default,
// so on a code where the quota was never set, reading the limit failed
// outright, and the gate hid calendar_book entirely — the symptom read as "a
// tool the visitor was authorized for just disappeared".
func defaultOf(f *mcpplugin.ConfigField) string {
	if f.Default == "" {
		return "null"
	}
	return f.Default
}

// Values — just the key/value pairs (a capability's implementation reads
// these). Same rule: declaration is authoritative, default is the fallback.
func (s *Store) Values(
	ctx context.Context, ownerID string, decl []mcpplugin.ConfigField,
) (map[string]json.RawMessage, error) {
	return s.ValuesScoped(ctx, OwnerScope(ownerID), decl)
}

// ValuesScoped — the key/value pairs at one attachment point.
func (s *Store) ValuesScoped(
	ctx context.Context, scope Scope, decl []mcpplugin.ConfigField,
) (map[string]json.RawMessage, error) {
	fields, err := s.GetScoped(ctx, scope, decl)
	if err != nil {
		return nil, err
	}
	out := make(map[string]json.RawMessage, len(fields))
	for i := range fields {
		out[fields[i].Key] = json.RawMessage(fields[i].Value)
	}
	return out, nil
}

// Set — overrides an owner's config for a capability.
func (s *Store) Set(
	ctx context.Context, ownerID string,
	decl []mcpplugin.ConfigField, values map[string]json.RawMessage,
) error {
	return s.SetScoped(ctx, OwnerScope(ownerID), decl, values)
}

// SetScoped — overrides the config at one attachment point (a singleton
// document: delete the old one, then insert the new one).
//
// Only accepts keys that are in the declaration; a key outside it is rejected
// outright — the caller sending a field that doesn't exist is the caller's
// fault, and it shouldn't be silently stored as garbage no one ever reads.
func (s *Store) SetScoped(
	ctx context.Context, scope Scope,
	decl []mcpplugin.ConfigField, values map[string]json.RawMessage,
) error {
	if err := writable(scope, decl, values); err != nil {
		return err
	}
	doc, merr := buildDoc(scope, values)
	if merr != nil {
		return merr
	}
	if err := s.clear(ctx, scope); err != nil {
		return err
	}
	if _, err := s.store.Insert(ctx, s.kind, s.capID, scope.collection, doc); err != nil {
		return fmt.Errorf("capconfig insert: %w", err)
	}
	return nil
}

// writable — two questions before a write: is there an attachment point, and
// do the key/values being written match the declaration.
func writable(
	scope Scope, decl []mcpplugin.ConfigField, values map[string]json.RawMessage,
) error {
	if !scope.ok() {
		return ErrNoScope
	}
	return check(decl, values)
}

// check — every gate before a write: the key must be declared, the value
// must match the declaration. A key outside the declaration shouldn't be
// silently stored as garbage no one ever reads.
func check(decl []mcpplugin.ConfigField, values map[string]json.RawMessage) error {
	declared := map[string]bool{}
	for i := range decl {
		declared[decl[i].Key] = true
	}
	for k := range values {
		if !declared[k] {
			return fmt.Errorf("%w: %q", ErrUnknownField, k)
		}
	}
	return validate(decl, values)
}

// stored — the keys explicitly set at this attachment point. Never set / no
// attachment point → an empty table (not an error).
func (s *Store) stored(
	ctx context.Context, scope Scope,
) (map[string]json.RawMessage, error) {
	if !scope.ok() {
		return map[string]json.RawMessage{}, nil
	}
	filter, ferr := scopeFilter(scope)
	if ferr != nil {
		return nil, ferr
	}
	recs, err := s.store.Query(ctx, s.kind, s.capID, scope.collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capconfig query: %w", err)
	}
	return decodeStored(recs, scope.key)
}

// decodeStored — singleton document → key/value table. No record → an empty
// table (not an error).
func decodeStored(
	recs []json.RawMessage, scopeKey string,
) (map[string]json.RawMessage, error) {
	if len(recs) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(recs[0], &doc); err != nil {
		return nil, fmt.Errorf("capconfig decode: %w", err)
	}
	delete(doc, scopeKey)
	return doc, nil
}

func (s *Store) clear(ctx context.Context, scope Scope) error {
	filter, ferr := scopeFilter(scope)
	if ferr != nil {
		return ferr
	}
	if _, err := s.store.Delete(ctx, s.kind, s.capID, scope.collection, filter); err != nil {
		return fmt.Errorf("capconfig clear: %w", err)
	}
	return nil
}

func scopeFilter(scope Scope) (json.RawMessage, error) {
	filter, err := json.Marshal(map[string]string{scope.key: scope.id})
	if err != nil {
		return nil, fmt.Errorf("capconfig filter: %w", err)
	}
	return filter, nil
}

func buildDoc(scope Scope, values map[string]json.RawMessage) ([]byte, error) {
	doc := make(map[string]json.RawMessage, len(values)+1)
	maps.Copy(doc, values)
	id, ierr := json.Marshal(scope.id)
	if ierr != nil {
		return nil, fmt.Errorf("capconfig scope id: %w", ierr)
	}
	doc[scope.key] = id
	out, merr := json.Marshal(doc)
	if merr != nil {
		return nil, fmt.Errorf("capconfig encode: %w", merr)
	}
	return out, nil
}
