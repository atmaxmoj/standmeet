// obsidian.go — implementation of the Obsidian vault sync integration.
//
// Currently only Writing has Obsidian sync columns (writings.obsidian_source_path /
// obsidian_imported_at), but the Integration interface is generic across Genre, so Wiki / Output
// can attach Obsidian sync in the future without touching the interface.

package connector

import "time"

// Obsidian — one Obsidian vault sync relationship. The document was ingested from a .md file at
// some relative path inside the vault; a re-import at the same source_path compares
// last_synced_at against document.updated_at to decide skip/overwrite.
type Obsidian struct {
	importedAt time.Time
	sourcePath string
}

// ObsidianInit — construction parameters (used by the postgres mapper).
type ObsidianInit struct {
	ImportedAt time.Time
	SourcePath string
}

// NewObsidian — construct an Obsidian value from Init.
func NewObsidian(i *ObsidianInit) Obsidian {
	return Obsidian{
		sourcePath: i.SourcePath,
		importedAt: i.ImportedAt,
	}
}

// --- Integration interface impl ---

// Kind — always returns IntegrationObsidian.
func (Obsidian) Kind() IntegrationKind { return IntegrationObsidian }

// SourceRef — the path relative to the vault, e.g. "essays/eval-is-the-product.md".
func (o Obsidian) SourceRef() string { return o.sourcePath }

// LastSyncedAt — the last import time.
func (o Obsidian) LastSyncedAt() time.Time { return o.importedAt }

// --- Obsidian-specific accessor ---
// A caller gets Integration back via Integrations.Find(IntegrationObsidian), then type-asserts
// it to Obsidian to use these methods. Named so they don't collide with the interface methods.

// VaultPath — a semantic alias for SourceRef, emphasizing the "path within the vault" meaning;
// for readability.
func (o Obsidian) VaultPath() string { return o.sourcePath }

// ImportedAt — a semantic alias for LastSyncedAt, emphasizing the "import time" meaning.
func (o Obsidian) ImportedAt() time.Time { return o.importedAt }
