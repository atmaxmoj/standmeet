// npm_wrap.go — a block that carries an npm package (`package:` in its manifest) installs it once,
// at block install, with lifecycle scripts off (docs/design/plugin/microsite-build.md "Wrapping an
// npm package as a block"). The result is a plain node_modules tree on the microsites volume; a
// microsite build copies it in, so no build ever runs npm.

package blockwire

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
)

const (
	// wrappedDirName — where wrapped packages live under the microsites root. Never served: public
	// serving resolves only <page_id>/<build_id>/dist from database rows, and `_` starts no uuid.
	wrappedDirName = "_blocks"
	// npmInstallTimeout — one package and its dependencies; a hung registry must not hold the
	// install.
	npmInstallTimeout = 2 * time.Minute
	// npmTailLines — how much of npm's own output the owner sees when the install fails.
	npmTailLines = 6
	// tmpSuffixBytes — randomness in the scratch dir's name, so two installs never share one.
	tmpSuffixBytes = 4
	// wrappedDirPerm — the backend writes, the builder (same user) reads.
	wrappedDirPerm = 0o750
)

// WrappedDir — the directory holding block <id>'s wrapped node_modules tree.
func WrappedDir(buildsRoot, id string) string {
	return filepath.Join(buildsRoot, wrappedDirName, id)
}

// wrapPackage — npm install <spec> into a scratch dir, then swap it into place. The scratch dir is
// on the same volume, so the final rename is atomic: a build never sees half a tree. No spec → no
// package to wrap.
//
// ponytail: no pre-bundle step; the microsite's own vite build bundles the package. Add an esbuild
// step (under bwrap) if the per-build cost matters.
func wrapPackage(ctx context.Context, d *deps.Runtime, id, spec string) error {
	if spec == "" {
		return nil
	}
	root := filepath.Join(d.BuildsRoot, wrappedDirName)
	if err := os.MkdirAll(root, wrappedDirPerm); err != nil {
		return fmt.Errorf("wrap package: %w", err)
	}
	tmp := filepath.Join(root, ".tmp-"+id+"-"+randSuffix())
	defer removeQuietly(tmp)
	if err := npmInstall(ctx, d.BlockMarket.Registry(), spec, tmp); err != nil {
		return err
	}
	return swapIn(tmp, WrappedDir(d.BuildsRoot, id))
}

// swapIn — the finished tree replaces the block's previous one (a re-install), cache left behind.
func swapIn(tmp, final string) error {
	removeQuietly(filepath.Join(tmp, ".npm-cache"))
	if err := os.RemoveAll(final); err != nil {
		return fmt.Errorf("wrap package: %w", err)
	}
	if err := os.Rename(tmp, final); err != nil {
		return fmt.Errorf("wrap package: %w", err)
	}
	return nil
}

// npmInstall — the one npm run: lifecycle scripts off, its own cache, the instance's registry.
func npmInstall(ctx context.Context, registry, spec, prefix string) error {
	ctx, cancel := context.WithTimeout(ctx, npmInstallTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "npm", "install", spec, "--prefix", prefix,
		"--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-save",
		"--registry", registry, "--cache", filepath.Join(prefix, ".npm-cache"))
	cmd.Env = append(os.Environ(), "npm_config_update_notifier=false")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fp.BadInput(fmt.Sprintf("could not install package %s: %s", spec, tail(string(out))))
	}
	return nil
}

// WrappedPackages — for a build of page pageID: the ids of the page owner's installed blocks that
// carry a package. Read from the database, never from the volume: a reset instance keeps the
// volume, and a leftover tree there must not make an uninstalled package importable.
// Best-effort: a failed read builds the page without them, and the build names what is missing.
func WrappedPackages(d *deps.Runtime) func(ctx context.Context, pageID string) []string {
	return func(ctx context.Context, pageID string) []string {
		rows, err := ownerBlocksOfPage(ctx, d, pageID)
		if err != nil {
			d.Log.Warn("wrapped packages", "page_id", pageID, "err", err)
			return []string{}
		}
		return packageBlockIDs(rows)
	}
}

func ownerBlocksOfPage(
	ctx context.Context, d *deps.Runtime, pageID string,
) ([]assembly.InstalledBlock, error) {
	page, err := d.MicrositeRepo.GetByID(ctx, pageID)
	if err != nil {
		return nil, fmt.Errorf("page: %w", err)
	}
	rows, lerr := d.Assembly.ListInstalled(ctx, page.OwnerID)
	if lerr != nil {
		return nil, fmt.Errorf("installed blocks: %w", lerr)
	}
	return rows, nil
}

// packageBlockIDs — the blocks whose stored manifest names a package.
func packageBlockIDs(rows []assembly.InstalledBlock) []string {
	ids := []string{}
	for i := range rows {
		m, err := plugin.ParseManifest([]byte(rows[i].Manifest))
		if err == nil && m.Package != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

// removeQuietly — clean-up of a scratch path; a failure leaves litter, never a wrong result.
func removeQuietly(p string) {
	if err := os.RemoveAll(p); err != nil {
		slog.Default().Warn("remove scratch path", "path", p, "err", err)
	}
}

func randSuffix() string {
	b := make([]byte, tmpSuffixBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// tail — npm's last few non-empty lines, which say what went wrong.
func tail(out string) string {
	lines := strings.FieldsFunc(out, func(r rune) bool { return r == '\n' })
	if len(lines) > npmTailLines {
		lines = lines[len(lines)-npmTailLines:]
	}
	return strings.TrimSpace(strings.Join(lines, " "))
}
