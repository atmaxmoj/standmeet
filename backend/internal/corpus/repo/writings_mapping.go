// writings_mapping.go — pure mapping helpers split out of writings.go (corpus_notes
// (genre='writing') row -> Writing, UUID/timestamp conversion, hue/visibility whitelist
// fallback). writing folded into corpus_notes (#151): body_md -> body, path not stored
// (derived as "writings/"+slug).

package repo

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// writingPathPrefix — the retriever/ACL path prefix for writings. path has no column;
// it's derived from slug as "writings/<slug>" (byte-for-byte identical to the value
// stored before the fold into corpus_notes, so ACL / eval fixtures don't change).
const writingPathPrefix = "writings/"

// writingPathForSlug — derives the path from a slug.
func writingPathForSlug(slug string) string { return writingPathPrefix + slug }

func rowsToDomainWritings(rows []db.CorpusNote) []entity.Writing {
	out := make([]entity.Writing, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainWriting(&rows[i]))
	}
	return out
}

type writingIDArgs struct {
	writingUUID pgtype.UUID
	ownerUUID   pgtype.UUID
}

func parseOwnerAndWritingID(ownerID, writingID string) (writingIDArgs, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return writingIDArgs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	writingUUID, perr := pgstore.ParseUUID(writingID)
	if perr != nil {
		return writingIDArgs{}, fmt.Errorf("parse writing id: %w", perr)
	}
	return writingIDArgs{ownerUUID: ownerUUID, writingUUID: writingUUID}, nil
}

func toDomainWriting(row *db.CorpusNote) entity.Writing {
	in := entity.WritingInit{
		ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		Slug: row.Slug, Title: row.Title, Excerpt: row.Excerpt,
		Body:        row.Body,
		Tags:        row.Tags,
		CrossRefs:   row.CrossRefs,
		Path:        writingPathForSlug(row.Slug),
		ParentID:    optUUIDString(row.ParentID),
		ReadMinutes: row.ReadMinutes,
		Cover: entity.CoverInit{
			Headline: row.CoverHeadline,
			Hue:      row.CoverHue, ImageAssetID: optUUIDString(row.CoverImageAssetID),
		},
		Visibility: entity.VisibilityInit{
			Mode: row.Visibility, LockedBody: row.LockedBody,
		},
		Timestamps: entity.TimestampsInit{
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
			PublishedAt: pgstore.OptTime(row.PublishedAt),
		},
		Integrations: buildWritingIntegrations(row),
	}
	return entity.NewWriting(&in)
}

// buildWritingIntegrations — translates the obsidian_source_path / _imported_at columns
// on a corpus_notes row into an Integration set at this mapper layer. When future columns
// for Notion / GitHub etc. are added, extend the if-branches here without touching domain.
func buildWritingIntegrations(row *db.CorpusNote) connector.Integrations {
	integrations := connector.NewIntegrations()
	if row.ObsidianSourcePath != "" {
		var importedAt time.Time
		if row.ObsidianImportedAt.Valid {
			importedAt = row.ObsidianImportedAt.Time
		}
		integrations.Add(connector.NewObsidian(&connector.ObsidianInit{
			SourcePath: row.ObsidianSourcePath,
			ImportedAt: importedAt,
		}))
	}
	return integrations
}

// optUUIDString — nullable uuid -> string (invalid -> ""). Shared by cover asset id and
// parent_id (returns string rather than *string, for the domain Init's string fields).
func optUUIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return pgstore.FormatUUID(u)
}

func writingCoverHueOr(hue string) string {
	switch hue {
	case entity.WritingCoverHueAmber, entity.WritingCoverHueViolet,
		entity.WritingCoverHueAcid:
		return hue
	}
	return entity.WritingCoverHueAmber
}

func writingVisibilityOr(v string) string {
	if v == entity.WritingVisibilityPrivate {
		return entity.WritingVisibilityPrivate
	}
	return entity.WritingVisibilityPublic
}
