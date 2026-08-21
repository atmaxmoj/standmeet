// vault_import.go —— 「上一次 vault 导入」的用例面（UX-62）。
//
// 导入本身住在 corpus 那边；这里只管**那件事发生过**这个事实的存取 —— 它挂在 owner 上，
// 因为一个实例只有一份 vault。

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// VaultImportStore —— 回执的存取口。仓储实现它，同步那条路写它，admin 那一屏读它。
type VaultImportStore interface {
	RecordVaultImport(ctx context.Context, ownerID string, rec entity.VaultImportReceipt) error
	GetVaultImportReceipt(ctx context.Context, ownerID string) (entity.VaultImportReceipt, error)
}
