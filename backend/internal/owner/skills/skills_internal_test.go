// skills_internal_test.go —— the Skills subsystem's rules, against an in-memory store. No DB, no
// other domain: the package imports nothing from corpus/code/microsite, so these tests compiling
// IS the independence check (S-independence); deleting another subsystem can never touch this one
// because there is no edge to it.

package skills

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// memStore —— an in-memory Store for the tests, keeping every version.
type memStore struct {
	rows map[string]map[string]*memSkill // ownerID -> slug -> skill
	mu   sync.Mutex
}

type memSkill struct {
	meta     Skill
	versions []string // body by version-1
}

func newMem() *memStore { return &memStore{rows: map[string]map[string]*memSkill{}} }

func (m *memStore) Insert(_ context.Context, ownerID string, s *Skill) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	own := m.own(ownerID)
	if own[s.Slug] != nil {
		return ErrSlugTaken
	}
	own[s.Slug] = &memSkill{meta: *s, versions: []string{s.Body}}
	return nil
}

func (m *memStore) NewVersion(
	_ context.Context, ownerID, slug, body string, at time.Time,
) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sk := m.own(ownerID)[slug]
	if sk == nil {
		return 0, ErrNotFound
	}
	sk.versions = append(sk.versions, body)
	sk.meta.Version = len(sk.versions)
	sk.meta.Body = body
	sk.meta.UpdatedAt = at
	return sk.meta.Version, nil
}

func (m *memStore) Delete(_ context.Context, ownerID, slug string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	own := m.own(ownerID)
	if own[slug] == nil {
		return ErrNotFound
	}
	delete(own, slug)
	return nil
}

func (m *memStore) List(_ context.Context, ownerID string) ([]Skill, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	own := m.own(ownerID)
	out := make([]Skill, 0, len(own))
	for _, sk := range own {
		out = append(out, sk.meta)
	}
	return out, nil
}

func (m *memStore) Get(_ context.Context, ownerID, slug string) (Skill, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sk := m.own(ownerID)[slug]
	if sk == nil {
		return Skill{}, ErrNotFound
	}
	return sk.meta, nil
}

func (m *memStore) GetVersion(
	_ context.Context, ownerID, slug string, version int,
) (Skill, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sk := m.own(ownerID)[slug]
	if sk == nil {
		return Skill{}, ErrNotFound
	}
	if version < 1 || version > len(sk.versions) {
		return Skill{}, ErrNoVersion
	}
	s := sk.meta
	s.Version, s.Body = version, sk.versions[version-1]
	return s, nil
}

func (m *memStore) own(ownerID string) map[string]*memSkill {
	if m.rows[ownerID] == nil {
		m.rows[ownerID] = map[string]*memSkill{}
	}
	return m.rows[ownerID]
}

const owner = "owner-1"

func newSvc() *Service {
	var n int64
	return NewService(newMem(), func() time.Time { n++; return time.Unix(n, 0).UTC() })
}

const (
	noteSlug = "note-taking"
	loopSlug = "interview-loop"
)

func mk(slug, name, body string, src Source) *NewInput {
	return &NewInput{Slug: slug, Name: name, Body: body, Source: src}
}

func TestNewSkillStartsAtVersionOne(t *testing.T) {
	t.Parallel()
	s := newSvc()
	sk, err := s.New(context.Background(), owner, mk(loopSlug, "I", "body", SourceBundled))
	require.NoError(t, err)
	require.Equal(t, 1, sk.Version)
	require.Equal(t, "body", sk.Body)
	require.Equal(t, SourceBundled, sk.Source)
}

func TestEditKeepsOldVersionRetrievable(t *testing.T) {
	t.Parallel()
	s := newSvc()
	ctx := context.Background()
	_, err := s.New(ctx, owner, mk(noteSlug, "Note", "v1 body", SourceOwner))
	require.NoError(t, err)

	ed, err := s.Edit(ctx, owner, noteSlug, "v2 body")
	require.NoError(t, err)
	require.Equal(t, 2, ed.Version)
	require.Equal(t, "v2 body", ed.Body)

	// version discipline: v1 is still retrievable by its number.
	old, err := s.GetVersion(ctx, owner, noteSlug, 1)
	require.NoError(t, err)
	require.Equal(t, "v1 body", old.Body)
}

func TestBundledSkillIsNotHandEdited(t *testing.T) {
	t.Parallel()
	s := newSvc()
	ctx := context.Background()
	_, err := s.New(ctx, owner, mk(loopSlug, "Interview", "body", SourceBundled))
	require.NoError(t, err)
	_, err = s.Edit(ctx, owner, loopSlug, "hacked")
	require.ErrorIs(t, err, ErrBundledEdit)
}

func TestSlugValidation(t *testing.T) {
	t.Parallel()
	s := newSvc()
	for _, bad := range []string{"Interview Loop", "a_b", "-x", "x-", "", "UPPER"} {
		_, err := s.New(context.Background(), owner, mk(bad, "n", "b", SourceOwner))
		require.ErrorIsf(t, err, ErrBadSlug, "slug %q should be rejected", bad)
	}
}

func TestReseedBundledBumpsVersionOnBodyChange(t *testing.T) {
	t.Parallel()
	s := newSvc()
	ctx := context.Background()
	_, err := s.New(ctx, owner, mk(loopSlug, "I", "v1 body", SourceBundled))
	require.NoError(t, err)

	// A release whose body is unchanged is a no-op: no version churn.
	require.NoError(t, s.reseedBundled(ctx, owner, mk(loopSlug, "I", "v1 body", SourceBundled)))
	cur, err := s.Get(ctx, owner, loopSlug)
	require.NoError(t, err)
	require.Equal(t, 1, cur.Version)

	// A release with a changed body ships as a new version; the old one stays retrievable.
	require.NoError(t, s.reseedBundled(ctx, owner, mk(loopSlug, "I", "v2 body", SourceBundled)))
	cur, err = s.Get(ctx, owner, loopSlug)
	require.NoError(t, err)
	require.Equal(t, 2, cur.Version)
	require.Equal(t, "v2 body", cur.Body)
	old, err := s.GetVersion(ctx, owner, loopSlug, 1)
	require.NoError(t, err)
	require.Equal(t, "v1 body", old.Body)
}

func TestListAndDelete(t *testing.T) {
	t.Parallel()
	s := newSvc()
	ctx := context.Background()
	_, err := s.New(ctx, owner, mk("one", "One", "b", SourceOwner))
	require.NoError(t, err)
	_, err = s.New(ctx, owner, mk("two", "Two", "b", SourceOwner))
	require.NoError(t, err)

	list, err := s.List(ctx, owner)
	require.NoError(t, err)
	require.Len(t, list, 2)

	require.NoError(t, s.Delete(ctx, owner, "one"))
	_, err = s.Get(ctx, owner, "one")
	require.ErrorIs(t, err, ErrNotFound)
}
