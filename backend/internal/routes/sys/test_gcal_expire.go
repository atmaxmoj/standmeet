// test_gcal_expire.go —— POST /internal/test/expire-gcal-token
//
// e2e knob: forces the first claimed owner's access_token_expires_at to
// past so the next BookMeeting triggers a refresh. Test-only — wrapped
// under /internal so external traffic can't reach it.

package sys

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/wangsijie/standmeet/internal/postgres"
)

// TestGCalExpireDeps —— deps for the expire-gcal-token endpoint.
type TestGCalExpireDeps struct {
	Owners *postgres.OwnerRepo
	DB     *pgxpool.Pool
	Log    *slog.Logger
}

// MountTestGCalExpire —— /internal/test/expire-gcal-token.
func MountTestGCalExpire(r chi.Router, deps TestGCalExpireDeps) {
	r.Post("/test/expire-gcal-token", expireGCalHandler(deps))
}

func expireGCalHandler(deps TestGCalExpireDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID, ok := lookupExpireOwnerID(r, &deps, w)
		if !ok {
			return
		}
		if upErr := expireOwnerToken(r.Context(), deps.DB, ownerID); upErr != nil {
			deps.Log.Error("expire token", "err", upErr)
			http.Error(w, "expire failed", http.StatusInternalServerError)
			return
		}
		writeExpireOK(w)
	}
}

func lookupExpireOwnerID(
	r *http.Request, deps *TestGCalExpireDeps, w http.ResponseWriter,
) (string, bool) {
	handle, herr := firstClaimedHandle(r, deps, w)
	if !herr {
		return "", false
	}
	owner, gerr := deps.Owners.GetByHandle(r.Context(), handle)
	if gerr != nil {
		deps.Log.Error("get owner by handle", "err", gerr)
		http.Error(w, "get owner failed", http.StatusInternalServerError)
		return "", false
	}
	return owner.ID, true
}

func firstClaimedHandle(
	r *http.Request, deps *TestGCalExpireDeps, w http.ResponseWriter,
) (string, bool) {
	handle, err := deps.Owners.FirstHandle(r.Context())
	if err != nil || handle == "" {
		http.Error(w, "no claimed owner", http.StatusBadRequest)
		return "", false
	}
	return handle, true
}

func writeExpireOK(w http.ResponseWriter) {
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(`{"ok":true}`)); err != nil {
		_ = err
	}
}

func expireOwnerToken(ctx context.Context, pool *pgxpool.Pool, ownerID string) error {
	past := time.Now().Add(-1 * time.Hour)
	ownerUUID := pgtype.UUID{}
	if err := ownerUUID.Scan(ownerID); err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	_, err := pool.Exec(ctx,
		`UPDATE owner_calendar_connectors
         SET access_token_expires_at = $1
         WHERE owner_id = $2 AND provider = 'google'`,
		pgtype.Timestamptz{Time: past, Valid: true}, ownerUUID)
	if err != nil {
		return fmt.Errorf("update connector: %w", err)
	}
	return nil
}
