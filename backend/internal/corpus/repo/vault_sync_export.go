// vault_sync_export.go — the half that **reads corpus out to the vault**.
//
// It's split from vault_sync.go not to make that file shorter: that file does "reconcile
// an incoming sync" (claim, reconcile, web-wins, prune), while this one does exactly one
// thing — pull out ALL of the owner's corpus notes in one shot and hand them to obsidian
// to render as .md. The two reads are fundamentally different: reconciliation claims rows
// one at a time by title / source_path, while export needs **the whole tree plus every
// field on every note**.
//
// And that phrase "every field" has always been false here (F-L-67): the `excerpt` /
// `css_classes` / `lang_labels` columns sit in the DB but this read never selected them,
// so the owner's synced-down copy came out missing them. The last time the same shape of
// bug was fixed (F-L-59, lang/aliases), that SELECT's comment already stated the right
// lesson — "the loss starts at this SELECT, not at rendering" — it just never got swept
// to the neighboring columns.

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ListAllForExport — all of the owner's corpus notes (any genre), for vault export to
// render back into .md.
func (r *VaultSyncRepo) ListAllForExport(ctx context.Context, ownerID string) ([]SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListAllNotesForExport(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("list notes for export: %w", qerr)
	}
	out := make([]SyncNote, 0, len(rows))
	for i := range rows {
		sn := SyncNote{
			ID: pgstore.FormatUUID(rows[i].ID), Genre: rows[i].Genre, Title: rows[i].Title,
			Body: rows[i].Body, Published: rows[i].Published, Tags: rows[i].Tags,
			Lang: rows[i].Lang, Aliases: rows[i].Aliases,
			Excerpt: rows[i].Excerpt, CSSClasses: rows[i].CssClasses,
			LangLabels:  decodeLangLabels(rows[i].LangLabels),
			SourcePath:  rows[i].ObsidianSourcePath,
			Frontmatter: rows[i].ObsidianFrontmatter,
		}
		if rows[i].ParentID.Valid {
			sn.ParentID = pgstore.FormatUUID(rows[i].ParentID)
		}
		out = append(out, sn)
	}
	return out, nil
}

// decodeLangLabels — `lang_labels` jsonb -> map. Treat a decode failure as absent: this
// column is **display labels** (code -> the text shown on the language switcher), so one
// bad row shouldn't fail the whole export, and generating from the code is its intended
// fallback path.
func decodeLangLabels(raw []byte) map[string]string {
	labels := map[string]string{}
	if len(raw) == 0 {
		return labels
	}
	if err := json.Unmarshal(raw, &labels); err != nil {
		return map[string]string{}
	}
	return labels
}
