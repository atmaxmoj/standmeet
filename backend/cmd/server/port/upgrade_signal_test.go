package port

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// pressTS1 / pressTS2 — two distinct button-press moments, so a repeat press writes a value
// that differs from the first.
const (
	pressTS1 = 1000
	pressTS2 = 2000
)

// TestSignalRedeployerConfigured — the button's can_apply rides on this: a signal path
// (the sidecar shipped) means configured; empty (no sidecar) means the panel honestly
// reports it can't act. Not hardcoded true.
func TestSignalRedeployerConfigured(t *testing.T) {
	if NewSignalRedeployer("").Configured() {
		t.Fatal("empty signal path (no sidecar) must be Configured()=false")
	}
	if !NewSignalRedeployer("/run/x").Configured() {
		t.Fatal("a signal path (sidecar present) must be Configured()=true")
	}
}

// TestSignalRedeployerUnconfigured — Trigger without a path must refuse, not silently
// no-op, so the op reports the real reason instead of a fake success.
func TestSignalRedeployerUnconfigured(t *testing.T) {
	err := NewSignalRedeployer("").Trigger(context.Background())
	if !errors.Is(err, ErrRedeployNotConfigured) {
		t.Fatalf("unconfigured Trigger must return ErrRedeployNotConfigured, got %v", err)
	}
}

// pressAt — trigger a press stamped at ts, and return the bytes the sidecar would read.
func pressAt(t *testing.T, r *SignalRedeployer, path string, ts int64) []byte {
	t.Helper()
	r.now = func() time.Time { return time.Unix(ts, 0) }
	if err := r.Trigger(context.Background()); err != nil {
		t.Fatalf("Trigger at %d: %v", ts, err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read after press at %d: %v", ts, err)
	}
	return b
}

// TestSignalRedeployerWritesAtomicSignal — the sidecar reads this file. A press must write the
// timestamp payload, atomically (no leftover .tmp for the sidecar to trip on).
func TestSignalRedeployerWritesAtomicSignal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.signal")
	got := pressAt(t, NewSignalRedeployer(path), path, pressTS1)
	if string(got) != "1000\n" {
		t.Fatalf("signal payload = %q, want the unix timestamp %q", got, "1000\n")
	}
	if _, statErr := os.Stat(path + ".tmp"); !os.IsNotExist(statErr) {
		t.Fatal("temp file left behind — write was not atomic (rename)")
	}
}

// TestSignalRedeployerFreshOnRepeat — pressing again must land a NEW timestamp, so a watching
// sidecar sees a change and upgrades again rather than ignoring the second press.
func TestSignalRedeployerFreshOnRepeat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.signal")
	r := NewSignalRedeployer(path)
	first := pressAt(t, r, path, pressTS1)
	second := pressAt(t, r, path, pressTS2)
	if bytes.Equal(second, first) {
		t.Fatal("pressing again must write a fresh timestamp so the sidecar sees a change")
	}
}
