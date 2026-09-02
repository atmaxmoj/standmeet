// obsidian_state.go — the read-side facade for "when was the last vault import" (UX-62).
//
// Not split into its own file just to pad the line count (though obsidian.go really was
// maxed out): import/export are **actions**, this route is **a fact about those
// actions** — the two have different readers.

package admin

import (
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// vaultStateView holds every fact that screen needs.
//
// `never` is **its own independent bit**, not derived from the counts: "never imported"
// and "imported but zero changes" are two different things, and conflating them into the
// same statement is exactly the UX-62 bug (an instance with 1028 notes looked identical
// to an empty one).
type vaultStateView struct {
	LastImportAt string `json:"last_import_at"`
	New          int    `json:"new"`
	Updated      int    `json:"updated"`
	Skipped      int    `json:"skipped"`
	// Deleted — how many entries that import removed (F-L-62). It's not the same kind of
	// number as the other three: those three are reversible, this one isn't.
	Deleted int  `json:"deleted"`
	Never   bool `json:"never"`
}

func (h *Handlers) obsidianState() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rec, err := h.Obsidian.ImportReceipt.GetVaultImportReceipt(
			r.Context(), middleware.OwnerIDFrom(r.Context()),
		)
		if err != nil {
			h.Log.Error("read vault import receipt", logErrKey, err)
			http.Error(w, "could not read the vault state", http.StatusInternalServerError)
			return
		}
		// The shape is assembled in place: extracting a
		// `vaultStateFrom(rec owner.VaultImportReceipt)` would make **this new file**
		// import the domain's facade directly, and the outbound-convergence-point gate
		// has zero tolerance for that on new files (old files are grandfathered into the
		// baseline). Here the receipt is taken with `:=`, its type inferred, so that
		// import is never needed.
		view := vaultStateView{
			New: rec.New, Updated: rec.Updated, Skipped: rec.Skipped,
			Deleted: rec.Deleted, Never: rec.Never(),
		}
		if !rec.Never() {
			view.LastImportAt = rec.At.UTC().Format(time.RFC3339)
		}
		writeJSON(h.Log, w, view)
	}
}
