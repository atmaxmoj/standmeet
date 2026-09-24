package periodic_test

import (
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

type dueCase struct {
	name    string
	expr    string
	since   string
	now     string
	wantDue bool
	wantErr bool
}

func ts(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse time %q: %v", s, err)
	}
	return v
}

func checkDue(t *testing.T, c dueCase) {
	t.Helper()
	due, err := periodic.CronDue(c.expr, ts(t, c.since), ts(t, c.now))
	if (err != nil) != c.wantErr {
		t.Fatalf("err=%v wantErr=%v", err, c.wantErr)
	}
	if !c.wantErr && due != c.wantDue {
		t.Fatalf("due=%v want %v", due, c.wantDue)
	}
}

// TestCronDue —— the decision follows real cron semantics (a tick fell since the last run), in
// UTC. A wrong implementation (always-true, off-by-a-day, wrong TZ) fails here.
func TestCronDue(t *testing.T) {
	t.Parallel()
	const daily = "0 0 * * *" // midnight UTC
	cases := []dueCase{
		{"crossed midnight", daily, "2026-09-23T10:00:00Z", "2026-09-24T00:01:00Z", true, false},
		{"same day", daily, "2026-09-24T00:05:00Z", "2026-09-24T12:00:00Z", false, false},
		{"@daily crossed", "@daily", "2026-09-23T10:00:00Z", "2026-09-24T00:01:00Z", true, false},
		{"empty never runs", "", "2026-09-23T10:00:00Z", "2030-01-01T00:00:00Z", false, false},
		{"malformed errors", "1 2 3", "2026-09-23T10:00:00Z", "2026-09-24T00:00:00Z", false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			checkDue(t, c)
		})
	}
}

// TestValidCron —— the write-boundary validator accepts good schedules and rejects junk.
func TestValidCron(t *testing.T) {
	t.Parallel()
	for _, ok := range []string{"", "0 0 * * *", "@daily", "*/30 * * * *"} {
		if err := periodic.ValidCron(ok); err != nil {
			t.Errorf("ValidCron(%q) = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"not a cron", "99 99 * * *", "0 0 *"} {
		if err := periodic.ValidCron(bad); err == nil {
			t.Errorf("ValidCron(%q) = nil, want error", bad)
		}
	}
}
