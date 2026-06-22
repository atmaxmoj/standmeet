// Package sandboxws —— per-visitor-session sandbox workspace lifecycle (#148).
//
// A visitor session that WRITES through a workspace-bearing sandboxed MCP gets its
// own directory under Root, bound writable at /workspace in the bwrap sandbox
// (isolated from other sessions). Those dirs must not grow without bound: the TTL
// is backend-controlled (SetTTL, not hard-baked) and a cron sweep (Sweep, also
// run on demand by a test hook) deletes dirs whose mtime is older than the TTL.
//
// Lazy: Provision is called at sandbox dial only for sessions using a
// workspace=true plugin; a session that never touches such a plugin gets no dir.
// Keyed by conversation id (sanitized to a single path segment — no traversal).
package sandboxws

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const dirMode = 0o700

// Manager —— owns the workspace root + the live TTL. Safe for concurrent use.
type Manager struct {
	now  func() time.Time
	root string
	ttl  time.Duration
	mu   sync.RWMutex
}

// Workspace —— one per-session workspace dir, as listed by the admin sandbox panel.
type Workspace struct {
	ModTime time.Time `json:"mod_time"`
	ID      string    `json:"id"`
	AgeSecs int64     `json:"age_secs"`
}

// New —— a manager rooted at root with an initial TTL. root is created if missing.
func New(root string, ttl time.Duration) (*Manager, error) {
	if root == "" {
		return nil, errors.New("sandboxws: empty root")
	}
	if err := os.MkdirAll(root, dirMode); err != nil {
		return nil, fmt.Errorf("sandboxws: mkdir root %q: %w", root, err)
	}
	return &Manager{root: root, ttl: ttl, now: time.Now}, nil
}

// Provision —— ensure (lazily) the per-session workspace dir exists + is fresh,
// return its absolute host path for bwrap to bind at /workspace. Touch keeps an
// actively-dialed session's dir from being swept mid-flight.
func (m *Manager) Provision(sessionID string) (string, error) {
	seg, err := safeSegment(sessionID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(m.root, seg)
	if mkErr := os.MkdirAll(dir, dirMode); mkErr != nil {
		return "", fmt.Errorf("sandboxws: provision %q: %w", seg, mkErr)
	}
	now := m.now()
	if cerr := os.Chtimes(dir, now, now); cerr != nil {
		return "", fmt.Errorf("sandboxws: touch %q: %w", seg, cerr)
	}
	return dir, nil
}

// SetTTL —— backend-controlled retention. Workspaces older than this are swept.
func (m *Manager) SetTTL(ttl time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ttl = ttl
}

// TTL —— current retention.
func (m *Manager) TTL() time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.ttl
}

// List —— active workspace dirs under root (each a per-session dir).
func (m *Manager) List() ([]Workspace, error) {
	entries, err := os.ReadDir(m.root)
	if err != nil {
		return nil, fmt.Errorf("sandboxws: list: %w", err)
	}
	now := m.now()
	out := make([]Workspace, 0, len(entries))
	for _, e := range entries {
		info, ierr := e.Info()
		if !e.IsDir() || ierr != nil {
			continue
		}
		out = append(out, Workspace{
			ID: e.Name(), ModTime: info.ModTime(),
			AgeSecs: int64(now.Sub(info.ModTime()).Seconds()),
		})
	}
	return out, nil
}

// Sweep —— delete every workspace dir whose mtime is older than the TTL. Returns
// the number removed. Run periodically by the cron + on demand by the test hook.
func (m *Manager) Sweep() (int, error) {
	ttl := m.TTL()
	list, err := m.List()
	if err != nil {
		return 0, err
	}
	cutoff := m.now().Add(-ttl)
	removed := 0
	for i := range list {
		if !list[i].ModTime.Before(cutoff) {
			continue
		}
		if rmErr := os.RemoveAll(filepath.Join(m.root, list[i].ID)); rmErr != nil {
			return removed, fmt.Errorf("sandboxws: sweep %q: %w", list[i].ID, rmErr)
		}
		removed++
	}
	return removed, nil
}

// safeSegment —— a conversation id must reduce to a single, non-empty path segment
// (no traversal, no separators). Anything else is rejected.
func safeSegment(id string) (string, error) {
	if !validSegment(id) {
		return "", fmt.Errorf("sandboxws: unsafe session id %q", id)
	}
	return id, nil
}

func validSegment(id string) bool {
	if id == "" || strings.ContainsRune(id, filepath.Separator) {
		return false
	}
	return filepath.Clean(id) == id && id != "." && id != ".."
}
