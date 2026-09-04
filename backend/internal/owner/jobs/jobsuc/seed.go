// jobs_seed.go — the two builtins the job loop needs to exist under the
// owner: the `hiring` prompt + role.
//
// **Why here, and not the kernel's roles_seed**: `hiring` is a concept that
// belongs to this plugin, not a kernel-level access tier. The first version
// put `HiringRoleName` into `access/entity` (next to `PublicRoleName` /
// `InvitedRoleName`), so the kernel ended up knowing a plugin's vocabulary,
// and `check-core-agnostic`'s CORE_DIRS doesn't cover access/entity — so that
// lock is structurally blind to this kind of leak, and `make lint` stays
// green anyway. Same lesson as the comment on PeriodicWorker: a plugin's
// thing lands in the wiring location only because that's where the hook is.
//
// **Why a separate role instead of reusing `invited`**: the two kinds of
// invitation need to see different things. A code issued from an approved
// gate request is for someone here to chat. A recruiter arriving via a
// resume QR will always ask about employers, start/end dates, work
// authorization — those facts live in subjectivity, and `invited`'s three
// globs don't include subjectivity. Adding it to `invited` would hand this
// PII to **every code the product issues**, gate-approval codes included.

package jobsuc

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// HiringPromptName / HiringRoleName — the names of these two builtins. The
// owner can see and edit them from /admin/prompts and /admin/roles.
// These names must match the two private constants in applications.go —
// same package, so they're reused directly.

const hiringPromptDescription = "Visitors who arrived from a job application, a resume QR, " +
	"or a recruiter conversation."

const hiringRoleDescription = "System default for codes the job loop issues — the QR on a " +
	"résumé. Everything an invitee reads, plus the CV entry: the employers, dates and " +
	"logistics a recruiter always asks for. Narrow it here if applications should show less."

// hiringRoleCorpusURIs — the three globs from invited, plus the CV one.
//
// ⚠️ `subjectivity://cv` is a **conventional name**, not something the
// product guarantees exists. If the owner names that note something else,
// this glob silently matches nothing, and the recruiter path quietly loses
// its CV with nothing alerting anyone. Why this is still acceptable: this
// allowlist is **visible and editable** on /admin/roles, the same posture as
// InvitedRoleCorpusURIs — the seed gives a starting point, and narrowing or
// renaming it is the owner's call.
var hiringRoleCorpusURIs = []string{
	"wiki://**",
	"output://**",
	"writing://**",
	"subjectivity://cv",
}

// hiringPromptBody — **establishes only a frame; asserts no fact about the
// owner.**
//
// The first version's body said "he", "is actively looking", "not a
// job-seeker" — that was tuning for my one instance, but it became the
// default for every instance: anyone installing StandMeet would get a prompt
// that refers to them as "he" and declares on their behalf that they're job
// hunting. The default should only say what this **channel** is (the visitor
// arrived from an application, answer as the candidate, never invent an
// employer); what to say about the person is the owner's own call in
// /admin/prompts.
//
// Written as concatenation rather than a backtick block: source lines can't
// exceed 100 characters, and the line breaks in this body are meaningful.
const hiringPromptBody = "This visitor arrived through a job application, a resume, or a\n" +
	"recruiter conversation. Treat that as established context for the whole session —\n" +
	"they are evaluating the owner as a candidate for a role.\n" +
	"\n" +
	"Answer as a strong candidate would: concrete, specific, evidence-first.\n" +
	"\n" +
	"- Lead with what the owner has actually built and what they did in it — the\n" +
	"  decision, the constraint, the trade-off, the measured outcome.\n" +
	"- Translate depth into the role's language. Say what the theory bought, not that\n" +
	"  they read it.\n" +
	"- When asked what they are suited for, answer with roles a company can actually\n" +
	"  hire for, and say why, from evidence. Not a personality verdict.\n" +
	"- The corpus's own marketing copy describes who the product serves. It is never a\n" +
	"  statement about the owner, and on this code it must not be read as one.\n" +
	"- When the corpus does not cover something a hiring manager reasonably needs —\n" +
	"  employment dates, titles, references, location, work authorization, compensation\n" +
	"  — say plainly that it is not in the notes and that the owner can answer it\n" +
	"  directly. Never guess these and never invent an employer.\n" +
	"- Say how much you looked at when the question is broad, so the visitor can judge\n" +
	"  the answer's base.\n" +
	"\n" +
	"Stay in the owner's voice, stay honest about gaps, and never oversell. A hiring\n" +
	"manager trusts specifics and distrusts adjectives."

// CVPresence — whether the CV the hiring role's glob covers actually exists.
// Narrow enough to be checked once, at code-issue time.
//
// Lives here in seed rather than applications.go: the glob is **seeded here**
// (hiringRoleCorpusURIs), so the interface that checks whether it's fulfilled
// follows it.
type CVPresence interface {
	Exists(ctx context.Context, ownerID, uri string) bool
}

// SeedDeps — the repositories needed to seed the builtins. The shell (internal/owner/jobs)
// holds it but doesn't know the domain facades: the arch rule says that package can only touch
// jobsuc's types.
type SeedDeps struct {
	Prompts *owner.PromptRepo
	Roles   *access.RoleRepo
	Sources *JobSourceRepo
	// SeedDefaults — seed the built-in aggregators on a fresh claim (config.SeedDefaultSources).
	// Off in e2e/dev so the suite doesn't get real external sources in every claimed owner.
	SeedDefaults bool
}

// SeedOwner — idempotent upsert (once on claim + once per startup).
func SeedOwner(ctx context.Context, deps SeedDeps, ownerID string) error {
	prompt, err := deps.Prompts.UpsertBuiltin(
		ctx, ownerID, hiringPromptName, hiringPromptDescription, hiringPromptBody,
	)
	if err != nil {
		return fmt.Errorf("upsert hiring prompt: %w", err)
	}
	promptID := prompt.ID()
	role, rerr := deps.Roles.UpsertBuiltin(ctx, &access.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        hiringRoleName,
		Description: hiringRoleDescription,
		PromptID:    &promptID,
	})
	if rerr != nil {
		return fmt.Errorf("upsert hiring role: %w", rerr)
	}
	if serr := deps.Roles.SetCorpusURIs(ctx, role.ID(), hiringRoleCorpusURIs); serr != nil {
		return fmt.Errorf("set hiring role corpus uris: %w", serr)
	}
	if !deps.SeedDefaults {
		return nil
	}
	return seedDefaultSources(ctx, deps.Sources, ownerID)
}

// seedDefaultSources — give a fresh instance the built-in aggregators (defaultSources). Runs on
// every startup but only seeds when the owner has ZERO sources, so it never clobbers or duplicates
// what the owner has: a first claim gets the full set; deleting one and restarting doesn't
// resurrect it; deleting them ALL re-populates the defaults on the next start.
func seedDefaultSources(ctx context.Context, repo *JobSourceRepo, ownerID string) error {
	existing, err := repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list sources for seed: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}
	for i := range defaultSources {
		if serr := createDefaultSource(ctx, repo, ownerID, &defaultSources[i]); serr != nil {
			return serr
		}
	}
	return nil
}

func createDefaultSource(
	ctx context.Context, repo *JobSourceRepo, ownerID string, d *defaultSource,
) error {
	var cfg []byte
	if d.config != "" {
		cfg = []byte(d.config)
	}
	if verr := jobfetch.ValidateKindConfig(d.kind, cfg); verr != nil {
		return fmt.Errorf("default source %q invalid: %w", d.label, verr)
	}
	if _, cerr := repo.Create(ctx, &jobsmodel.CreateJobSourceInput{
		OwnerID: ownerID, Kind: d.kind, Label: d.label, Config: cfg,
	}); cerr != nil {
		return fmt.Errorf("seed default source %q: %w", d.label, cerr)
	}
	return nil
}
