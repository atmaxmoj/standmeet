// load.go — read a tree of blocks off any filesystem.
//
// One loader, where there were two. The two plugin axes this design replaced each
// walked their own directory into their own struct, and the two functions differed
// only in the type they filled; adding a third kind of thing would have meant a
// third copy. This one takes an fs.FS, so the built-in blocks compiled into the
// binary and the blocks an owner installed onto a data volume are read by the same
// code. Neither is privileged, because there is only one path.

package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// manifestFile — the name every block's declaration goes by.
const manifestFile = "manifest.yaml"

// Load — every block in fsys, one per top-level directory.
//
// A directory without a manifest is an error, not a skip. Silently ignoring one
// would let a block that failed to install look exactly like a block nobody asked
// for, and the owner would be told nothing.
func Load(fsys fs.FS) ([]Manifest, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, fmt.Errorf("read blocks dir: %w", err)
	}
	out := make([]Manifest, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, lerr := loadOne(fsys, e.Name())
		if lerr != nil {
			return nil, lerr
		}
		out = append(out, m)
	}
	return out, nil
}

// ParseManifest — one declaration, with no directory behind it.
//
// The owner's install path: they paste the text of a `manifest.yaml` into the panel,
// and there is no block directory to read a spec or a binding out of. Everything else
// is the same check the built-in tree gets, deliberately — a block that came in through
// the panel is not a lesser kind of block, and the moment the two paths validate
// differently the owner's is the one that gets the surprising behaviour.
//
// A bad manifest comes back as an error with a reason, because the owner is standing at
// the form and can fix it. That is the whole difference from the built-in path, which
// panics: theirs is an asset in the image, this one is input.
func ParseManifest(raw []byte) (Manifest, error) {
	var m Manifest
	if uerr := yaml.Unmarshal(raw, &m); uerr != nil {
		return Manifest{}, fmt.Errorf("parse manifest: %w", uerr)
	}
	if m.ID == "" {
		return Manifest{}, errors.New("manifest declares no id")
	}
	if m.Version != SupportedVersion {
		return Manifest{}, fmt.Errorf("unsupported manifest version %q", m.Version)
	}
	if verr := validateSchemas(&m); verr != nil {
		return Manifest{}, verr
	}
	// No transport check, deliberately. A block that declares no way to start is
	// legitimate and is the acceptance test's own subject: "a fixture block that exists
	// only as data appears in the admin with its settings form rendered from its Config
	// schema" (`tests.md` §3). Such a block lists, carries settings, and joins a bundle;
	// it simply has nothing to dial, so it contributes no tools to a session. Rejecting
	// it here would make "a block is a directory and a declaration" false for exactly
	// the smallest block — a font, a theme, a permission — which is the case the whole
	// model exists to make cheap.
	injectHostSocket(&m)
	return m, nil
}

// loadOne — one block directory.
func loadOne(fsys fs.FS, dir string) (Manifest, error) {
	raw, err := fs.ReadFile(fsys, path.Join(dir, manifestFile))
	if err != nil {
		return Manifest{}, fmt.Errorf("read %s manifest: %w", dir, err)
	}
	m, perr := parseAndValidate(raw, dir)
	if perr != nil {
		return Manifest{}, perr
	}
	if rerr := readNamedFiles(fsys, dir, &m); rerr != nil {
		return Manifest{}, rerr
	}
	injectHostSocket(&m)
	return m, nil
}

// parseAndValidate — the checks that need only the manifest text, done before anything
// touches the filesystem again. Every failure names the directory, because a boot error that
// does not say WHICH block is one you have to bisect.
func parseAndValidate(raw []byte, dir string) (Manifest, error) {
	var m Manifest
	if uerr := yaml.Unmarshal(raw, &m); uerr != nil {
		return Manifest{}, fmt.Errorf("parse %s manifest: %w", dir, uerr)
	}
	if m.ID == "" {
		return Manifest{}, fmt.Errorf("block %s: manifest declares no id", dir)
	}
	if verr := validateSchemas(&m); verr != nil {
		return Manifest{}, fmt.Errorf("block %s: %w", dir, verr)
	}
	return m, nil
}

// HostSocketEnv — the env var the host puts a block's own host-socket path in.
//
// One name for every block; the path is derived from the id. Each builtin used to
// pick its own name (BOOKER_SOCKET / RETRIEVAL_SOCKET / …) with the path hand-written
// again on the host side — the same thing under four names and four places to mistype
// a path. A declaration now only says *which ops it needs*.
const HostSocketEnv = "STANDMEET_HOST_SOCKET"

// injectHostSocket — a block that ordered host ops is told where its socket is.
//
// The manifest never writes a path: `host_ops` is the whole declaration, and the
// address is the host's business. A block that ordered nothing gets no variable and no
// socket — fully offline, with no way back.
//
// This ran in the consuming axis's loader before the two loaders merged, and the merge
// dropped it. Nothing failed at boot: the sandbox still launched, `hostdesk` still
// opened the socket, and every host call inside simply answered "STANDMEET_HOST_SOCKET
// not set" — so booking, retrieval, summarize and mail-sender all went quiet at once
// while the host log stayed clean, because no host op was ever reached to fail. Moving
// a block means moving its edges too, and this is the edge.
func injectHostSocket(m *Manifest) {
	s := m.Transport.Sandbox
	if s == nil || len(s.HostOps) == 0 {
		return
	}
	if m.Transport.Env == nil {
		m.Transport.Env = map[string]string{}
	}
	m.Transport.Env[HostSocketEnv] = hostop.SocketPath(m.ID)
}

// readNamedFiles — pull in the files the transport names.
//
// A declaration names an OpenAPI spec and a binding rather than inlining them, so
// something has to read them, and the loader is the only place that knows where the
// block's directory is. Reading them here also means a manifest naming a file it does
// not ship fails with the block's id attached, instead of surfacing as a nil spec at
// the first call.
func readNamedFiles(fsys fs.FS, dir string, m *Manifest) error {
	// into before name: field order follows pointer width (govet fieldalignment).
	for _, f := range []struct {
		into *[]byte
		name string
	}{
		{into: &m.Transport.SpecBytes, name: m.Transport.Spec},
		{into: &m.Transport.BindingBytes, name: m.Transport.Binding},
	} {
		if f.name == "" {
			continue
		}
		raw, err := fs.ReadFile(fsys, path.Join(dir, f.name))
		if err != nil {
			return fmt.Errorf("block %s: read %s: %w", dir, f.name, err)
		}
		// Expand here, not at the point of use: a spec is parsed by several readers
		// (assembly, the credential form, the admin's validate) and any one of them
		// that forgot would see a placeholder where a URL should be.
		*f.into = expandEnv(raw)
	}
	return nil
}

// validateSchemas — an owner tool's input schema must be valid JSON, checked here
// rather than where it is served.
//
// One unmarshalable schema takes down the marshal of the WHOLE tool table, so a
// single bad block would empty the owner's tool list with no hint which block did
// it. That has happened. Failing at load names the block.
func validateSchemas(m *Manifest) error {
	for i := range m.OwnerTools {
		s := m.OwnerTools[i].InputSchema
		if s == "" {
			continue
		}
		if !json.Valid([]byte(s)) {
			return fmt.Errorf("owner tool %q: input_schema is not valid JSON", m.OwnerTools[i].Name)
		}
	}
	return nil
}
