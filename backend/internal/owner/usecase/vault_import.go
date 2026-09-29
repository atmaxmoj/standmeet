// vault_import.go — the usecase surface for "the last vault import" (UX-62).
//
// The import itself lives on the corpus side; this only manages storage/retrieval of
// the fact that **it happened** — attached to owner, because one instance has exactly
// one vault.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// VaultImportStore — the port for storing/retrieving the receipt. VaultImports implements
// it, the sync path writes it, the admin screen reads it.
type VaultImportStore interface {
	RecordVaultImport(ctx context.Context, ownerID string, rec entity.VaultImportReceipt) error
	GetVaultImportReceipt(ctx context.Context, ownerID string) (entity.VaultImportReceipt, error)
}

// VaultImports —— the receipt store: the receipt and its vault.imported commit together.
type VaultImports struct {
	Owners *repo.Repo
	Events events.Recorder
}

// RecordVaultImport —— stores the receipt and records vault.imported, in one transaction.
func (v VaultImports) RecordVaultImport(
	ctx context.Context, ownerID string, rec entity.VaultImportReceipt,
) error {
	return pgstore.InTx(ctx, v.Owners.Pool(), func(tx pgstore.Tx) error {
		if err := v.Owners.With(tx).RecordVaultImport(ctx, ownerID, rec); err != nil {
			return err
		}
		data := map[string]int{"created": rec.New, "updated": rec.Updated, "deleted": rec.Deleted}
		return v.Events.With(tx).Record(ctx, ownerID, VaultImported, "vault/"+ownerID, data)
	})
}

// GetVaultImportReceipt —— the last import's receipt.
func (v VaultImports) GetVaultImportReceipt(
	ctx context.Context, ownerID string,
) (entity.VaultImportReceipt, error) {
	return v.Owners.GetVaultImportReceipt(ctx, ownerID)
}
