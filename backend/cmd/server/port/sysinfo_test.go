package port

import (
	"errors"
	"testing"
)

// TestPingCheck — health.OK genuinely reflects the ping result, not a hardcoded true.
// This is exactly the point a prior e2e couldn't prove (in e2e the dependency is
// always up → ok===true is indistinguishable from a hardcoded true; killing the
// shared db would be too destructive). A plain function unit test nails it down
// directly: nil err → OK true; non-nil err (ping failed) → OK false. db.Ping is the
// source of err (see healthChecks).
func TestPingCheck(t *testing.T) {
	up := pingCheck("database", "postgres", nil)
	if !up.OK {
		t.Fatal("nil error (dependency up) must be OK=true, got false")
	}
	if up.Name != "database" || up.Detail != "postgres" {
		t.Fatalf("pingCheck dropped name/detail: %+v", up)
	}
	down := pingCheck("database", "postgres", errors.New("connection refused"))
	if down.OK {
		t.Fatal("non-nil error (ping failed) must be OK=false, got true — OK is NOT hardcoded")
	}
}
