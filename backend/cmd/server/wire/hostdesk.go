// hostdesk.go — opens the socket for each block's **declared** host ops.
//
// This replaces the original four hand-written gateways (retrieval / summarize /
// mail-sender / booker): each stood up its own socket and hung its own verbs on it, so the
// only way to answer "what can a sandbox ask the host for" was to read those four files.
// Now the vocabulary lives in internal/routes/hostdesk, each block orders by name from
// its own manifest, and this file dispatches accordingly.
//
// Naming an op that's not in the vocabulary -> **crashes at startup**. A manifest claiming it
// needs something the host doesn't provide at all is a lie, and it shouldn't wait until a
// visitor triggers it to be discovered.

package wire

import (
	"context"
	"fmt"
	"os"

	"github.com/atmaxmoj/standmeet/cmd/server/blockwire"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

const socketDirMode = 0o700

// HostDesk — walks the builtin manifests and opens one socket for each block that
// declares HostOps.
func HostDesk(
	ctx context.Context, d *deps.Runtime, skills *conversation.VisitorSkillsDeps,
) {
	if mkErr := os.MkdirAll(hostdesk.SocketDir, socketDirMode); mkErr != nil {
		d.Log.Error("host socket dir", "err", mkErr)
		return
	}
	shared := sharedHostDeps(d, skills)
	manifests := blockwire.BuiltinManifests()
	for i := range manifests {
		serveHostOps(ctx, d, shared, &manifests[i])
	}
}

// serveHostOps — one block: assemble its own isolated storage and config, gather the
// ops it names, open the socket.
func serveHostOps(
	ctx context.Context, d *deps.Runtime, shared *hostdesk.Deps, m *plugin.Manifest,
) {
	want := blockwire.HostOpsOf(m)
	if len(want) == 0 {
		return // a plugin that wants no backend data: fully cut off, doesn't even get a socket.
	}
	// Opening the socket and telling the block where it is are two halves of one fact,
	// and they lived in two files. When the loaders merged, the second half was dropped:
	// sockets were still opened, sandboxes still launched, and every host call inside
	// answered "STANDMEET_HOST_SOCKET not set". Nothing failed here, because nothing
	// here was wrong — booking, retrieval, summarize and mail-sender simply went quiet.
	// A socket nobody can find is not a working plugin, so refuse to start instead.
	if m.Transport.Env[plugin.HostSocketEnv] == "" {
		panic(fmt.Sprintf(
			"hostdesk: block %q orders %d host ops but was never told its socket path (%s unset)",
			m.ID, len(want), plugin.HostSocketEnv))
	}
	per := blockwire.PerBlockDeps(d, m)
	srv, serr := hostdesk.Serve(ctx, d.Log, m.ID, want, hostdesk.Collect(shared, per))
	if serr != nil {
		// Declaring an op the host doesn't provide = the manifest is lying; crash at startup.
		panic(serr)
	}
	_ = srv
}

// sharedHostDeps — the handful of things that don't depend on the block (corpus,
// conversation, owner, suppliers).
//
// The LLM resolver comes from the visitor-skills deps: the same object, so visitor tools and
// sandboxed blocks go through the same credential-resolution path.
func sharedHostDeps(
	d *deps.Runtime, skills *conversation.VisitorSkillsDeps,
) *hostdesk.Deps {
	return &hostdesk.Deps{
		Conversation: conversation.OpsHost{
			Chats: d.ChatRepo, Resolver: skills.Resolver, Reports: skills.Reports,
		},
		Corpus:    CorpusIndexDeps(d),
		Owners:    d.OwnerRepo,
		Suppliers: d.BlockDispatch,
	}
}

// CorpusIndexDeps — the single ingredient set for "reading the corpus", assembled in one
// place.
//
// Sandboxed blocks use it to read the corpus via host ops; freezing a role snapshot also
// uses it to judge whether a waypoint's evidence_ref actually points to a real note (F-A-26).
// The two must be the same set — the moment "what can the agent read" and "is the guidance
// target reachable" are each assembled separately, they drift apart, and nothing will ever
// error out on the day they do.
func CorpusIndexDeps(d *deps.Runtime) *corpus.IndexDeps {
	return &corpus.IndexDeps{
		Wiki: d.WikiRepo, Output: d.OutputRepo, Writings: d.WritingRepo,
		Subjectivity: d.SubjectivityRepo, VaultSync: d.VaultSyncRepo,
		NoteRefs: d.NoteRefRepo, Searcher: d.SearchClient,
		// Media: when a visitor reads a corpus entry, its images / attachments come
		// along with it. Visibility is pure inheritance — the "reading the entry" step
		// has already passed ACL, media hangs off the back of it and isn't judged again.
		Media: &corpus.NoteAssetsDeps{
			Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
			Hero:   d.NoteHeroRepo,
		},
	}
}
