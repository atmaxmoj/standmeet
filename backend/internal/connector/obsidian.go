// obsidian.go —— Obsidian vault sync integration 实现。
//
// 现在只 Writing 有 Obsidian sync 列（writings.obsidian_source_path /
// obsidian_imported_at），但 Integration 接口跨 Genre 通用，将来 Wiki /
// Output 也能挂 Obsidian sync 不动接口。

package connector

import "time"

// Obsidian —— 一份 Obsidian vault 同步关系。document 是从 vault 里某个
// 相对路径下的 .md 文件 ingest 来的；同一 source_path 再次 import 会按
// last_synced_at 跟 document.updated_at 比对决定 skip/overwrite。
type Obsidian struct {
	importedAt time.Time
	sourcePath string
}

// ObsidianInit —— 构造参数 (postgres mapper 用)。
type ObsidianInit struct {
	ImportedAt time.Time
	SourcePath string
}

// NewObsidian —— 从 Init 构造 Obsidian 值。
func NewObsidian(i *ObsidianInit) Obsidian {
	return Obsidian{
		sourcePath: i.SourcePath,
		importedAt: i.ImportedAt,
	}
}

// --- Integration interface impl ---

// Kind —— 永远返 IntegrationObsidian。
func (Obsidian) Kind() IntegrationKind { return IntegrationObsidian }

// SourceRef —— vault 内相对路径，例 "essays/eval-is-the-product.md"。
func (o Obsidian) SourceRef() string { return o.sourcePath }

// LastSyncedAt —— 上次 import 时间。
func (o Obsidian) LastSyncedAt() time.Time { return o.importedAt }

// --- Obsidian-specific accessor ---
// caller 通过 Integrations.Find(IntegrationObsidian) 拿回 Integration 后再
// type-assert 成 Obsidian 用这些方法。命名跟接口方法不撞。

// VaultPath —— SourceRef 的语义别名，强调"vault 内路径"语义；可读性。
func (o Obsidian) VaultPath() string { return o.sourcePath }

// ImportedAt —— LastSyncedAt 的语义别名，强调"import 时间"语义。
func (o Obsidian) ImportedAt() time.Time { return o.importedAt }
