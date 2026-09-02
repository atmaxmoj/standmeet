// vault_import.go — the usecase surface for "the last vault import" (UX-62).
//
// The import itself lives on the corpus side; this only manages storage/retrieval of
// the fact that **it happened** — attached to owner, because one instance has exactly
// one vault.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// VaultImportStore — the port for storing/retrieving the receipt. The repo implements
// it, the sync path writes it, the admin screen reads it.
type VaultImportStore interface {
	RecordVaultImport(ctx context.Context, ownerID string, rec entity.VaultImportReceipt) error
	GetVaultImportReceipt(ctx context.Context, ownerID string) (entity.VaultImportReceipt, error)
}
