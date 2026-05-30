// writings_mapping.go —— writings.go 拆出来的纯映射 helpers (sqlc row →
// domain.Writing，UUID/timestamp 互转，hue/visibility 白名单兜底)。

package postgres

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
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
	return domain.Writing{
		ID: formatUUID(row.ID), OwnerID: formatUUID(row.OwnerID),
		Slug: row.Slug, Title: row.Title, Excerpt: row.Excerpt,
		BodyMD:             row.BodyMd,
		CoverHeadline:      row.CoverHeadline,
		CoverSub:           row.CoverSub,
		CoverHue:           row.CoverHue,
		CoverImageAssetID:  optAssetIDString(row.CoverImageAssetID),
		Tags:               row.Tags,
		Visibility:         row.Visibility,
		CrossRefs:          row.CrossRefs,
		Path:               row.Path,
		ReadMinutes:        row.ReadMinutes,
		LockedBody:         row.LockedBody,
		ObsidianSourcePath: row.ObsidianSourcePath,
		ObsidianImportedAt: optTime(row.ObsidianImportedAt),
		PublishedAt:        optTime(row.PublishedAt),
		CreatedAt:          row.CreatedAt.Time,
		UpdatedAt:          row.UpdatedAt.Time,
	}
}

func optAssetIDString(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := formatUUID(u)
	return &s
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
