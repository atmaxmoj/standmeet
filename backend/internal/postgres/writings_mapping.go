// writings_mapping.go —— writings.go 拆出来的纯映射 helpers (sqlc row →
// domain.Writing，UUID/timestamp 互转，hue/visibility 白名单兜底)。

package postgres

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

func rowsToDomainWritings(rows []dbq.Writing) []domain.Writing {
	out := make([]domain.Writing, 0, len(rows))
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
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return writingIDArgs{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	writingUUID, perr := parseUUID(writingID)
	if perr != nil {
		return writingIDArgs{}, fmt.Errorf("parse writing id: %w", perr)
	}
	return writingIDArgs{ownerUUID: ownerUUID, writingUUID: writingUUID}, nil
}

func toDomainWriting(row *dbq.Writing) domain.Writing {
	in := domain.WritingInit{
		ID: formatUUID(row.ID), OwnerID: formatUUID(row.OwnerID),
		Slug: row.Slug, Title: row.Title, Excerpt: row.Excerpt,
		Body:        row.BodyMd,
		Tags:        row.Tags,
		CrossRefs:   row.CrossRefs,
		Path:        row.Path,
		ReadMinutes: row.ReadMinutes,
		Cover: domain.CoverInit{
			Headline: row.CoverHeadline, Sub: row.CoverSub,
			Hue: row.CoverHue, ImageAssetID: optAssetIDStringOr(row.CoverImageAssetID),
		},
		Visibility: domain.VisibilityInit{
			Mode: row.Visibility, LockedBody: row.LockedBody,
		},
		Timestamps: domain.TimestampsInit{
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
			PublishedAt: optTime(row.PublishedAt),
		},
		Integrations: buildWritingIntegrations(row),
	}
	return domain.NewWriting(&in)
}

// buildWritingIntegrations —— writings 表里的 obsidian_source_path /
// _imported_at 列在 mapper 这一层翻译成 Integration 集合。未来加 Notion /
// GitHub 等列时在这一块扩 if branch，不动 domain。
func buildWritingIntegrations(row *dbq.Writing) domain.Integrations {
	integrations := domain.NewIntegrations()
	if row.ObsidianSourcePath != "" {
		var importedAt time.Time
		if row.ObsidianImportedAt.Valid {
			importedAt = row.ObsidianImportedAt.Time
		}
		integrations.Add(domain.NewObsidian(&domain.ObsidianInit{
			SourcePath: row.ObsidianSourcePath,
			ImportedAt: importedAt,
		}))
	}
	return integrations
}

// optAssetIDStringOr —— optAssetIDString 的"返字符串而不返 *string"版，
// 给新的 CoverInit.ImageAssetID (string) 用。
func optAssetIDStringOr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return formatUUID(u)
}

func optTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	tt := t.Time
	return &tt
}

func writingCoverHueOr(hue string) string {
	switch hue {
	case domain.WritingCoverHueAmber, domain.WritingCoverHueViolet, domain.WritingCoverHueAcid:
		return hue
	}
	return domain.WritingCoverHueAmber
}

func writingVisibilityOr(v string) string {
	if v == domain.WritingVisibilityPrivate {
		return domain.WritingVisibilityPrivate
	}
	return domain.WritingVisibilityPublic
}
