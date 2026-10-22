// Package skillpg is the Postgres-backed store for the Skills subsystem: it implements
// skills.Store over the agent_skills / agent_skill_versions tables and nothing else. It is the edge
// that keeps the skills domain package pure; it reaches no other domain's tables.
package skillpg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/skills"
)

// Store —— the agent-skills tables.
type Store struct{ pool *pgstore.Pool }

// New —— the store over a pool.
func New(pool *pgstore.Pool) *Store { return &Store{pool: pool} }

const (
	insertSkillSQL = `INSERT INTO agent_skills
		(owner_id, slug, name, description, source, current_version, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`
	insertVersionSQL = `INSERT INTO agent_skill_versions (skill_id, version, body, created_at)
		VALUES ($1,$2,$3,$4)`
	lockSkillSQL = `SELECT id, current_version FROM agent_skills
		WHERE owner_id=$1 AND slug=$2 FOR UPDATE`
	bumpVersionSQL = `UPDATE agent_skills SET current_version=$3, updated_at=$4
		WHERE owner_id=$1 AND slug=$2`
	deleteSkillSQL = `DELETE FROM agent_skills WHERE owner_id=$1 AND slug=$2`
	currentCols    = `s.slug, s.name, s.description, s.source, s.current_version,
		s.created_at, s.updated_at`
	listSQL = `SELECT ` + currentCols + `, v.body
		FROM agent_skills s JOIN agent_skill_versions v
		  ON v.skill_id=s.id AND v.version=s.current_version
		WHERE s.owner_id=$1 ORDER BY s.name`
	getSQL = `SELECT ` + currentCols + `, v.body
		FROM agent_skills s JOIN agent_skill_versions v
		  ON v.skill_id=s.id AND v.version=s.current_version
		WHERE s.owner_id=$1 AND s.slug=$2`
	getVersionSQL = `SELECT s.slug, s.name, s.description, s.source, v.version, s.created_at,
		v.created_at, v.body
		FROM agent_skills s JOIN agent_skill_versions v ON v.skill_id=s.id
		WHERE s.owner_id=$1 AND s.slug=$2 AND v.version=$3`
)

const (
	uniqueViolation = "23505"
	ownerIDErr      = "owner id: %w"
)

// Insert —— write a new skill and its first version in one transaction.
func (s *Store) Insert(ctx context.Context, ownerID string, sk *skills.Skill) error {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(ownerIDErr, err)
	}
	return pgstore.InTx(ctx, s.pool, func(tx pgstore.Tx) error {
		var id pgtype.UUID
		if serr := tx.QueryRow(ctx, insertSkillSQL, owner, sk.Slug, sk.Name, sk.Description,
			string(sk.Source), sk.Version, sk.CreatedAt, sk.UpdatedAt).Scan(&id); serr != nil {
			return insertErr(serr)
		}
		_, verr := tx.Exec(ctx, insertVersionSQL, id, sk.Version, sk.Body, sk.CreatedAt)
		if verr != nil {
			return fmt.Errorf("insert version: %w", verr)
		}
		return nil
	})
}

// insertErr —— a unique-violation on (owner_id, slug) is the slug-taken error; anything else wraps.
func insertErr(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == uniqueViolation {
		return skills.ErrSlugTaken
	}
	return fmt.Errorf("insert skill: %w", err)
}

// NewVersion —— append a version to an existing skill and make it current.
func (s *Store) NewVersion(
	ctx context.Context, ownerID, slug, body string, at time.Time,
) (int, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return 0, fmt.Errorf(ownerIDErr, err)
	}
	var next int
	err = pgstore.InTx(ctx, s.pool, func(tx pgstore.Tx) error {
		var id pgtype.UUID
		var cur int
		if lerr := tx.QueryRow(ctx, lockSkillSQL, owner, slug).Scan(&id, &cur); lerr != nil {
			return skills.ErrNotFound
		}
		next = cur + 1
		if _, verr := tx.Exec(ctx, insertVersionSQL, id, next, body, at); verr != nil {
			return fmt.Errorf("insert version: %w", verr)
		}
		if _, berr := tx.Exec(ctx, bumpVersionSQL, owner, slug, next, at); berr != nil {
			return fmt.Errorf("bump version: %w", berr)
		}
		return nil
	})
	return next, err
}

// Delete —— remove a skill; its versions cascade.
func (s *Store) Delete(ctx context.Context, ownerID, slug string) error {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(ownerIDErr, err)
	}
	tag, err := s.pool.Exec(ctx, deleteSkillSQL, owner, slug)
	if err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return skills.ErrNotFound
	}
	return nil
}

// List —— every skill's current version for the owner.
func (s *Store) List(ctx context.Context, ownerID string) ([]skills.Skill, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(ownerIDErr, err)
	}
	rows, err := s.pool.Query(ctx, listSQL, owner)
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	defer rows.Close()
	return collectSkills(rows)
}

func collectSkills(rows pgx.Rows) ([]skills.Skill, error) {
	out := []skills.Skill{}
	for rows.Next() {
		sk, serr := scanCurrent(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, sk)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("list skills: %w", rerr)
	}
	return out, nil
}

// Get —— one skill's current version.
func (s *Store) Get(ctx context.Context, ownerID, slug string) (skills.Skill, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return skills.Skill{}, fmt.Errorf(ownerIDErr, err)
	}
	sk, err := scanCurrent(s.pool.QueryRow(ctx, getSQL, owner, slug))
	if err != nil {
		return skills.Skill{}, skills.ErrNotFound
	}
	return sk, nil
}

// GetVersion —— one skill at an exact version.
func (s *Store) GetVersion(
	ctx context.Context, ownerID, slug string, version int,
) (skills.Skill, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return skills.Skill{}, fmt.Errorf(ownerIDErr, err)
	}
	var sk skills.Skill
	var source string
	err = s.pool.QueryRow(ctx, getVersionSQL, owner, slug, version).Scan(
		&sk.Slug, &sk.Name, &sk.Description, &source, &sk.Version, &sk.CreatedAt,
		&sk.UpdatedAt, &sk.Body)
	if err != nil {
		return skills.Skill{}, skills.ErrNoVersion
	}
	sk.Source = skills.Source(source)
	return sk, nil
}

func scanCurrent(row pgx.Row) (skills.Skill, error) {
	var sk skills.Skill
	var source string
	if err := row.Scan(&sk.Slug, &sk.Name, &sk.Description, &source, &sk.Version,
		&sk.CreatedAt, &sk.UpdatedAt, &sk.Body); err != nil {
		return skills.Skill{}, fmt.Errorf("scan skill: %w", err)
	}
	sk.Source = skills.Source(source)
	return sk, nil
}
