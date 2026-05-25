// posts_mapping.go —— posts.go 拆出来的纯映射 helpers (sqlc row →
// domain.Post，UUID/timestamp 互转，hue/visibility 白名单兜底)。

package postgres

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

func rowsToDomainPosts(rows []dbq.Post) []domain.Post {
	out := make([]domain.Post, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainPost(&rows[i]))
	}
	return out
}

type postIDArgs struct {
	postUUID  pgtype.UUID
	ownerUUID pgtype.UUID
}

func parseOwnerAndPostID(ownerID, postID string) (postIDArgs, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return postIDArgs{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	postUUID, perr := parseUUID(postID)
	if perr != nil {
		return postIDArgs{}, fmt.Errorf("parse post id: %w", perr)
	}
	return postIDArgs{ownerUUID: ownerUUID, postUUID: postUUID}, nil
}

func toDomainPost(row *dbq.Post) domain.Post {
	return domain.Post{
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

func postCoverHueOr(hue string) string {
	switch hue {
	case domain.PostCoverHueAmber, domain.PostCoverHueViolet, domain.PostCoverHueAcid:
		return hue
	}
	return domain.PostCoverHueAmber
}

func postVisibilityOr(v string) string {
	if v == domain.PostVisibilityPrivate {
		return domain.PostVisibilityPrivate
	}
	return domain.PostVisibilityPublic
}
