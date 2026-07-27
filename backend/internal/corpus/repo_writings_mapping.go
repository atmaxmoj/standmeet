// writings_mapping.go —— writings.go 拆出来的纯映射 helpers (corpus_notes(genre='writing')
// row → Writing，UUID/timestamp 互转，hue/visibility 白名单兜底)。
// writing 折进 corpus_notes(#151):body_md→body，path 不存(派生 "writings/"+slug)。

package corpus

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/postgres/dbq"
)

// writingPathPrefix —— writing 的 retriever/ACL path 前缀。path 不存列,由 slug 派生
// "writings/<slug>"(跟折进 corpus_notes 前的存储值逐字一致,ACL / eval fixture 不变)。
const writingPathPrefix = "writings/"

// writingPathForSlug —— slug → 派生 path。
func writingPathForSlug(slug string) string { return writingPathPrefix + slug }

func rowsToDomainWritings(rows []dbq.CorpusNote) []Writing {
	out := make([]Writing, 0, len(rows))
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

func toDomainWriting(row *dbq.CorpusNote) Writing {
	in := WritingInit{
		ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		Slug: row.Slug, Title: row.Title, Excerpt: row.Excerpt,
		Body:        row.Body,
		Tags:        row.Tags,
		CrossRefs:   row.CrossRefs,
		Path:        writingPathForSlug(row.Slug),
		ParentID:    optUUIDString(row.ParentID),
		ReadMinutes: row.ReadMinutes,
		Cover: CoverInit{
			Headline: row.CoverHeadline,
			Hue:      row.CoverHue, ImageAssetID: optUUIDString(row.CoverImageAssetID),
		},
		Visibility: VisibilityInit{
			Mode: row.Visibility, LockedBody: row.LockedBody,
		},
		Timestamps: TimestampsInit{
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
			PublishedAt: pgstore.OptTime(row.PublishedAt),
		},
		Integrations: buildWritingIntegrations(row),
	}
	return NewWriting(&in)
}

// buildWritingIntegrations —— corpus_notes 行里的 obsidian_source_path /
// _imported_at 列在 mapper 这一层翻译成 Integration 集合。未来加 Notion /
// GitHub 等列时在这一块扩 if branch，不动 domain。
func buildWritingIntegrations(row *dbq.CorpusNote) connector.Integrations {
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

// optUUIDString —— 可空 uuid → 字符串(invalid → "")。cover asset id + parent_id
// 共用(返 string 而非 *string,给 domain Init 的 string 字段)。
func optUUIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return pgstore.FormatUUID(u)
}

func writingCoverHueOr(hue string) string {
	switch hue {
	case WritingCoverHueAmber, WritingCoverHueViolet,
		WritingCoverHueAcid:
		return hue
	}
	return WritingCoverHueAmber
}

func writingVisibilityOr(v string) string {
	if v == WritingVisibilityPrivate {
		return WritingVisibilityPrivate
	}
	return WritingVisibilityPublic
}
