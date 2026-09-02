// role_dock_buttons.go — #109/#110 the domain config + invariants for per-role chat dock buttons.
//
// A role has at most two dock buttons (chat has two button slots). Each button carries one
// capability + a "trigger" string — the visitor clicking the button sends the trigger as
// their own message (a shortcut). Title resolution + code-deny filtering happen at the
// session assembly layer; the domain only owns the pure config invariants: count <=2,
// trigger non-empty.

package entity

import (
	"errors"
	"slices"
	"strings"
)

// MaxDockButtons —— chat has two button slots, so the cap is 2.
const MaxDockButtons = 2

// DockButtonConfig —— an owner's config for one dock button: which capability it carries +
// the trigger string sent on click. A pure config carrier, with json tags so roleView /
// snapshot can serialize it directly (title is added separately at the session assembly layer).
type DockButtonConfig struct {
	CapabilityID string `json:"capability_id"`
	Trigger      string `json:"trigger"`
}

// ErrTooManyDockButtons —— more than two dock buttons were configured.
var ErrTooManyDockButtons = errors.New("at most two dock buttons per role")

// ErrDockButtonEmptyTrigger —— a dock button has no trigger string filled in (clicking it
// would do nothing).
var ErrDockButtonEmptyTrigger = errors.New("dock button needs a non-empty trigger")

// ErrUnknownDockCapability —— a dock button carries a capability the role does not have /
// that does not exist.
var ErrUnknownDockCapability = errors.New("dock button references an unknown capability")

// ValidateDockButtonCapabilities —— every button's capability must be in the valid set
// (route hands in the set of capability ids this role may carry, from the capability
// registry). An empty valid set is treated as "no capability may be carried" -> any button
// is rejected.
func ValidateDockButtonCapabilities(buttons []DockButtonConfig, valid []string) error {
	for i := range buttons {
		if !slices.Contains(valid, buttons[i].CapabilityID) {
			return ErrUnknownDockCapability
		}
	}
	return nil
}

// ValidateDockButtons —— pure config validation: count <=2, every trigger non-empty after
// trim. Empty/nil is valid.
func ValidateDockButtons(buttons []DockButtonConfig) error {
	if len(buttons) > MaxDockButtons {
		return ErrTooManyDockButtons
	}
	for i := range buttons {
		if strings.TrimSpace(buttons[i].Trigger) == "" {
			return ErrDockButtonEmptyTrigger
		}
	}
	return nil
}

// cloneDockButtons —— defensive copy (the slice + its elements are all values, a shallow
// copy is enough).
func cloneDockButtons(buttons []DockButtonConfig) []DockButtonConfig {
	return slices.Clone(buttons)
}
