// Package capconfig — the socket inbound controller: a capability inside the sandbox asks the
// host for **its own config**.
//
// Why a dedicated op instead of letting the sandbox call capstore.query on that doc itself:
// **the defaults live in the declaration** (the manifest's ConfigField.Default), and the
// declaration lives on the host. If the sandbox queried storage directly, an owner who never
// set a value would read back nothing — forcing the sandbox to write its own second copy of
// the defaults, exactly the duplicate this is meant to eliminate.
//
// So this op returns **the final, already-defaulted values**: declaration union owner
// overrides. The sandbox just uses what it gets — it doesn't need to know which values are
// defaults and which were overridden.
//
// Like capstore, it's bound to one cap's namespace at construction time — the sandbox can't
// fill in someone else's id.
package capconfig

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// BoundConfig — a config reader already bound to one cap (no kind/id/declaration: fixed at
// construction time).
type BoundConfig interface {
	Values(ctx context.Context, ownerID string) (map[string]json.RawMessage, error)
}

// Ops — capconfig.get. Read-only: the owner changes config through the panel, not through the
// sandbox.
//
// With this op, the sandbox doesn't need to write its own copy of the defaults — the host
// already backfills the declared defaults.
//
// cfg is nil (this capability declared no config) → don't expose the op. A source with
// nothing to give says so itself.
func Ops(cfg BoundConfig) []hostop.Op {
	if cfg == nil {
		return []hostop.Op{}
	}
	return []hostop.Op{{
		Name:        "capconfig.get",
		Description: "Read your own declared settings (values in effect, defaults filled in).",
		Invoke:      getHandler(cfg),
	}}
}

type getReq struct {
	OwnerID string `json:"owner_id"`
}

func getHandler(cfg BoundConfig) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req getReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capconfig.get: decode: %w", err)
		}
		values, err := cfg.Values(ctx, req.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("capconfig.get: %w", err)
		}
		out, merr := json.Marshal(values)
		if merr != nil {
			return nil, fmt.Errorf("capconfig.get: marshal: %w", merr)
		}
		return out, nil
	}
}
