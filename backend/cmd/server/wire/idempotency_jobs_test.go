package wire

// The job loop's reactions (jobsuc.Subscriptions) under the registry-driven idempotency test:
// an application's first conversation marks it engaged, a withdrawal revokes its code, a bundle's
// clock clears and restores the assessments in it.

import (
	"context"
	"testing"
)

// appOnCode —— an application and the code it holds.
type appOnCode struct{ app, code string }

// application —— an application on a fresh code.
func (h *idem) application(t *testing.T, code string) appOnCode {
	t.Helper()
	ctx := context.Background()
	var appID, codeID string
	if err := h.d.DB.QueryRow(ctx, `WITH r AS (
		INSERT INTO roles (owner_id, name) VALUES ($1, $2) RETURNING id)
		INSERT INTO access_codes (owner_id, code, label, slug, assumed_role_id)
		SELECT $1, $3, $4, $5, r.id FROM r RETURNING id`,
		h.owner, "role-"+code, code, code, code).Scan(&codeID); err != nil {
		t.Fatalf("insert code: %v", err)
	}
	if err := h.d.DB.QueryRow(ctx, `INSERT INTO applications
		(owner_id, access_code_id, job_snapshot, resume_content) VALUES ($1, $2, '{}', '{}')
		RETURNING id`, h.owner, codeID).Scan(&appID); err != nil {
		t.Fatalf("insert application: %v", err)
	}
	return appOnCode{app: appID, code: codeID}
}

// scalar —— one value of the row with this id, read back as text.
func (h *idem) scalar(t *testing.T, sql, id string) string {
	t.Helper()
	var s string
	if err := h.d.DB.QueryRow(context.Background(), sql, id).Scan(&s); err != nil {
		t.Fatalf("read back: %v", err)
	}
	return s
}

func driveApplicationEngaged(t *testing.T, h *idem) []idemCase {
	t.Helper()
	a := h.application(t, "ENGAGE-1")
	ev := h.record(t, "conversation.started", "conversation/c-engaged", "conversation_id",
		map[string]string{"conversation_id": "c-engaged", "code_id": a.code})
	return []idemCase{{label: "first conversation", eventID: ev, observe: func() string {
		return h.scalar(t,
			`SELECT (engaged_at IS NOT NULL)::text FROM applications WHERE id = $1`, a.app)
	}}}
}

func driveWithdrawRevokes(t *testing.T, h *idem) []idemCase {
	t.Helper()
	a := h.application(t, "WITHDRAW-1")
	ev := h.record(t, "application.outcome_changed", "application/"+a.app, "application_id",
		map[string]string{"application_id": a.app, "to": "withdrawn"})
	return []idemCase{{label: "application withdrawn", eventID: ev, observe: func() string {
		return h.scalar(t, `SELECT status FROM access_codes WHERE id = $1`, a.code)
	}}}
}

// seenOnBundle —— an assessed job and the bundle whose clock it is on.
type seenOnBundle struct{ seen, bundle string }

// seenInBundle —— one assessed job on a fresh bundle.
func (h *idem) seenInBundle(t *testing.T, key string) seenOnBundle {
	t.Helper()
	ctx := context.Background()
	var seenID, bundleID string
	if err := h.d.DB.QueryRow(ctx, `INSERT INTO retention_bundles (owner_id) VALUES ($1)
		RETURNING id`, h.owner).Scan(&bundleID); err != nil {
		t.Fatalf("insert bundle: %v", err)
	}
	if err := h.d.DB.QueryRow(ctx, `INSERT INTO job_seen
		(owner_id, url_key, snapshot, annotations, bundle_id)
		VALUES ($1, $2, '{}', '{"reason":"deal"}', $3) RETURNING id`, h.owner, key, bundleID,
	).Scan(&seenID); err != nil {
		t.Fatalf("insert job_seen: %v", err)
	}
	return seenOnBundle{seen: seenID, bundle: bundleID}
}

// assessment —— whether the job's assessment is in place or in the trash.
func (h *idem) assessment(t *testing.T, seenID string) string {
	t.Helper()
	return h.scalar(t, `SELECT CASE WHEN s.cleared_at IS NULL THEN 'kept ' ELSE 'cleared ' END ||
		(SELECT count(*) FROM job_assessment_trash WHERE job_seen_id = s.id)::text || ' in trash'
		FROM job_seen s WHERE s.id = $1`, seenID)
}

func (h *idem) bundleEvent(t *testing.T, typ, bundleID string) string {
	t.Helper()
	return h.record(t, typ, "retention_bundle/"+bundleID, "bundle_id",
		map[string]string{"bundle_id": bundleID})
}

func driveRetentionClears(t *testing.T, h *idem) []idemCase {
	t.Helper()
	s := h.seenInBundle(t, "https://jobs.example/clear")
	ev := h.bundleEvent(t, "retention.bundle_cleared", s.bundle)
	return []idemCase{{label: "bundle cleared", eventID: ev, observe: func() string {
		return h.assessment(t, s.seen)
	}}}
}

func driveRetentionRestores(t *testing.T, h *idem) []idemCase {
	t.Helper()
	s := h.seenInBundle(t, "https://jobs.example/restore")
	h.deliver(t, "jobs.retention_clears", h.bundleEvent(t, "retention.bundle_cleared", s.bundle))
	ev := h.bundleEvent(t, "retention.bundle_restored", s.bundle)
	return []idemCase{{label: "bundle restored", eventID: ev, observe: func() string {
		return h.assessment(t, s.seen)
	}}}
}
