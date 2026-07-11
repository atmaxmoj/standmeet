// sweep_toctou_test.go —— #14: Sweep must re-stat a dir right before removing it, so a workspace
// revived between the List snapshot and the RemoveAll is not wiped (List→RemoveAll TOCTOU).

package sandboxws

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// fixed clock anchor (no time.Now, deterministic).
const (
	baseYear = 2026
	baseHour = 12
)

func TestStillStaleRestat(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	base := time.Date(baseYear, 1, 1, baseHour, 0, 0, 0, time.UTC)
	cutoff := base.Add(-time.Hour)

	dir := filepath.Join(root, "sess")
	require.NoError(t, os.Mkdir(dir, dirMode))

	// stale: mtime 2h before base → older than cutoff → eligible for sweep.
	old := base.Add(-2 * time.Hour)
	require.NoError(t, os.Chtimes(dir, old, old))
	require.True(t, stillStale(dir, cutoff), "an old dir is still stale")

	// revived: Provision touches the dir to now → newer than cutoff → must be kept.
	require.NoError(t, os.Chtimes(dir, base, base))
	require.False(t, stillStale(dir, cutoff), "a revived dir must not be swept")

	// gone: a dir removed out from under us is not stale (nothing to remove).
	require.False(t, stillStale(filepath.Join(root, "absent"), cutoff))
}
