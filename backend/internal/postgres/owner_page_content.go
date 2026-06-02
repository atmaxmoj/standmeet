// owner_page_content.go —— Owner aggregate 的 "公开页内容" 切面（与
// identity / settings 平行）。物理上 page_content 是独立表（FK 到
// owners.id），但聚合边界上跟 Owner 走同一事务边界，所以这里是
// OwnerRepo 的方法而非独立 PageRepo。jsonb 列在 Repo 层 marshal /
// unmarshal，让 usecase / routes 拿到 typed domain.PageContent。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// GetPageContent 拿 owner 的 page_content；不存在返 ErrPageNotFound
// （usecase 层用默认值兜底）。
func (r *OwnerRepo) GetPageContent(
	ctx context.Context, ownerID string,
) (domain.PageContent, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.PageContent{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetPageContent(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return domain.PageContent{}, domain.ErrPageNotFound
		}
		return domain.PageContent{}, fmt.Errorf("get page content: %w", err)
	}
	return rowToPageContent(&row)
}

// UpsertPageContent 写入 / 更新 owner 的 page_content（admin PUT 用）。
func (r *OwnerRepo) UpsertPageContent(
	ctx context.Context, ownerID string, in *domain.PageContent,
) (domain.PageContent, error) {
	q := dbq.New(r.pool)
	pgID, perr := parseUUID(ownerID)
	if perr != nil {
		return domain.PageContent{}, fmt.Errorf("parse owner id: %w", perr)
	}
	params, perr := pageContentToParams(pgID, in)
	if perr != nil {
		return domain.PageContent{}, perr
	}
	row, err := q.UpsertPageContent(ctx, params)
	if err != nil {
		return domain.PageContent{}, fmt.Errorf("upsert page content: %w", err)
	}
	return rowToPageContent(&row)
}

// marshaledSections —— pageContentToParams 拆分用：把 5 段 json.Marshal
// 合并到一个 helper，让 cyclop ≤ 5。
type marshaledSections struct {
	examples, insights, projects, where, contact []byte
}

func marshalSections(in *domain.PageContent) (marshaledSections, error) {
	var out marshaledSections
	// 字段顺序按 govet fieldalignment：src (interface, 2 ptrs) 在前，
	// dst (slice ptr, 1 ptr) 在中，name (string, 1 ptr) 在尾。
	parts := []struct {
		src  any
		dst  *[]byte
		name string
	}{
		{in.HeroExamples, &out.examples, "hero_examples"},
		{in.Insights, &out.insights, "insights"},
		{in.Projects, &out.projects, "projects"},
		{in.Where, &out.where, "where"},
		{in.Contact, &out.contact, "contact"},
	}
	for i := range parts {
		b, err := json.Marshal(parts[i].src)
		if err != nil {
			return marshaledSections{}, fmt.Errorf("marshal %s: %w", parts[i].name, err)
		}
		*parts[i].dst = b
	}
	return out, nil
}

func pageContentToParams(
	pgID pgtype.UUID, in *domain.PageContent,
) (dbq.UpsertPageContentParams, error) {
	sections, err := marshalSections(in)
	if err != nil {
		return dbq.UpsertPageContentParams{}, err
	}
	return dbq.UpsertPageContentParams{
		OwnerID:      pgID,
		HeroProse:    in.HeroProse,
		HeroExamples: sections.examples,
		Insights:     sections.insights,
		Projects:     sections.projects,
		WhereSection: sections.where,
		Contact:      sections.contact,
	}, nil
}

func rowToPageContent(row *dbq.PageContent) (domain.PageContent, error) {
	pc := domain.PageContent{
		OwnerID:   formatUUID(row.OwnerID),
		HeroProse: row.HeroProse,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if err := unmarshalSections(row, &pc); err != nil {
		return domain.PageContent{}, err
	}
	return pc, nil
}

func unmarshalSections(row *dbq.PageContent, pc *domain.PageContent) error {
	// 字段顺序按 govet fieldalignment：dst (interface, 2 ptrs) 在前，
	// name (string, 1 ptr) 在中，raw (slice, len/cap 无 ptr 尾段) 在尾。
	parts := []struct {
		dst  any
		name string
		raw  []byte
	}{
		{&pc.HeroExamples, "hero_examples", row.HeroExamples},
		{&pc.Insights, "insights", row.Insights},
		{&pc.Projects, "projects", row.Projects},
		{&pc.Where, "where_section", row.WhereSection},
		{&pc.Contact, "contact", row.Contact},
	}
	for i := range parts {
		if err := json.Unmarshal(parts[i].raw, parts[i].dst); err != nil {
			return fmt.Errorf("unmarshal %s: %w", parts[i].name, err)
		}
	}
	return nil
}
