// page.go — the usecase for querying public page content.
// GetPublicPage: single-owner instance -> fetch the sole owner -> page_content. A
// missing owner -> ErrOwnerNotFound (pre-claim); a missing page_content row -> returns
// default values (so a visitor opening a freshly created instance still sees default
// content instead of a blank page).
// Defaults come from the design mockup docs/design/project/page-content.js.
//
// After the handle-URL removal: every "resolve owner by handle" path collapsed down to
// "fetch the sole owner" — public page / wiki landing / custom page all now go through
// LoadSoleOwner.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PageDeps — what the page usecase needs. PageContent is the content facet of the
// Owner aggregate, so GetPageContent / UpsertPageContent are both OwnerRepo methods;
// this usecase no longer holds a separate PageRepo. Wiki is used for pin joins
// (GetPublicPage); a caller that only invokes LoadSoleOwner may leave it unset.
type PageDeps struct {
	Owners *repo.Repo
	Wiki   *corpus.WikiRepo
}

// PublicPageView — the shape returned by GET /api/v1/page.
// The Owner part picks out public fields, content is the rendered view (insights/projects
// already joined into cards), and the timestamp is the page's last-updated.
type PublicPageView struct {
	Owner   PublicOwnerView `json:"owner"`
	Content PageContentView `json:"content"`
}

// PageContentView — the rendered view of page_content: the stored pin list (wiki ids)
// joined into PagePinCard (title + excerpt + path). The AI (page.get) and a visitor see
// the same shape. Field order follows govet fieldalignment.
type PageContentView struct {
	UpdatedAt    time.Time            `json:"updated_at"`
	Where        entity.PageWhere     `json:"where"`
	Contact      entity.PageContact   `json:"contact"`
	OwnerID      string               `json:"owner_id"`
	HeroProse    string               `json:"hero_prose"`
	HeroExamples []string             `json:"hero_examples"`
	Insights     []entity.PagePinCard `json:"insights"`
	Projects     []entity.PagePinCard `json:"projects"`
}

// PublicOwnerView — the owner slice exposed to visitors (no email / password_hash).
// The handle field is kept — used by the admin UI / for display — but it **no longer
// determines routing**.
type PublicOwnerView struct {
	Handle   string `json:"handle"`
	FullName string `json:"full_name"`
	Location string `json:"location"`
}

// LoadSoleOwner — v1 single-owner instance: fetches the one owner. pre-claim
// (not yet claimed) -> ErrOwnerNotFound. The app root path / SEO / public routes all
// go through this.
func LoadSoleOwner(ctx context.Context, deps PageDeps) (entity.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return entity.Owner{}, entity.ErrOwnerNotFound
	}
	sole, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return entity.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return sole, nil
}

// SetupTokenIssuer — the minimal interface EnsureUnclaimedSetupToken needs (wraps
// session.IssueSetupToken + InstanceRepo). Keeps the usecase layer from importing the
// session package -> which belongs to the routes layer.
type SetupTokenIssuer interface {
	// UsableToken — the plaintext that **can genuinely claim right now**; returns an
	// empty string if there isn't one.
	//
	// This is not two independent questions of "does a hash exist" plus "is the holder
	// non-empty" (F-L-56): even when both are true, they can still be mismatched — memory
	// holding TA while the DB holds hash(TB). The link that went out then 401s while both
	// questions answer "all good", and self-healing never triggers.
	// There's exactly one criterion: **does hashing the plaintext I'm holding equal the
	// hash in the DB**.
	UsableToken(ctx context.Context) (string, error)
	// IssueAndStore — generates a new plaintext + writes the DB hash + writes the holder,
	// returns the new plaintext. Returning it directly rather than making the caller ask
	// the holder again: an extra call in between would reopen a window for interleaving.
	IssueAndStore(ctx context.Context) (string, error)
}

// EnsureUnclaimedSetupToken — called by the /api/v1/instance handler during the
// unclaimed period; returns a setup_token plaintext guaranteed to be usable (so the
// frontend can redirect to /setup?t=...).
//
// The decision tree has only two branches:
//   - The plaintext in hand hashes to the same value as the DB's hash -> use it
//   - Everything else (hash is NULL / holder is empty / **the two halves don't match**)
//     -> issue a fresh one
//
// The third case is the one actually hit in a real environment, and it **does not heal
// itself**: the owner's `/setup?t=...` link keeps 401ing until someone restarts the
// backend. Self-hosting dies right here, in its first minute.
func EnsureUnclaimedSetupToken(ctx context.Context, issuer SetupTokenIssuer) (string, error) {
	usable, err := issuer.UsableToken(ctx)
	if err != nil {
		return "", fmt.Errorf("check setup token: %w", err)
	}
	if usable != "" {
		return usable, nil
	}
	fresh, ierr := issuer.IssueAndStore(ctx)
	if ierr != nil {
		return "", fmt.Errorf("issue setup token: %w", ierr)
	}
	return fresh, nil
}

// GetPublicPage — sole owner -> page_content (fill defaults if missing) -> pin join
// into the rendered view.
func GetPublicPage(ctx context.Context, deps PageDeps) (PublicPageView, error) {
	soleOwner, err := LoadSoleOwner(ctx, deps)
	if err != nil {
		if errors.Is(err, entity.ErrOwnerNotFound) {
			return PublicPageView{}, entity.ErrOwnerNotFound
		}
		return PublicPageView{}, err
	}
	content, err := loadPageContentOrDefault(ctx, deps, soleOwner.ID)
	if err != nil {
		return PublicPageView{}, err
	}
	view, err := BuildPageContentView(ctx, deps, soleOwner.ID, &content)
	if err != nil {
		return PublicPageView{}, err
	}
	return PublicPageView{
		Owner: PublicOwnerView{
			Handle:   soleOwner.Handle,
			FullName: soleOwner.FullName,
			Location: soleOwner.Location,
		},
		Content: view,
	}, nil
}

// BuildPageContentView — storage shape -> rendered view (pin join). page.get MCP goes
// through this too, so what the AI sees matches what a visitor sees.
func BuildPageContentView(
	ctx context.Context, deps PageDeps, ownerID string, content *entity.PageContent,
) (PageContentView, error) {
	join, err := LoadPinJoin(ctx, PagePinDeps(deps), ownerID, content)
	if err != nil {
		return PageContentView{}, err
	}
	return PageContentView{
		UpdatedAt:    content.UpdatedAt,
		Where:        content.Where,
		Contact:      content.Contact,
		OwnerID:      content.OwnerID,
		HeroProse:    content.HeroProse,
		HeroExamples: content.HeroExamples,
		Insights:     ResolvePinCards(join.Cards, join.Paths, content.Insights),
		Projects:     ResolvePinCards(join.Cards, join.Paths, content.Projects),
	}, nil
}

func loadPageContentOrDefault(
	ctx context.Context, deps PageDeps, ownerID string,
) (entity.PageContent, error) {
	content, err := deps.Owners.GetPageContent(ctx, ownerID)
	if errors.Is(err, entity.ErrPageNotFound) {
		return buildDefaultPage(ownerID), nil
	}
	if err != nil {
		return entity.PageContent{}, fmt.Errorf("get page content: %w", err)
	}
	return content, nil
}

// DefaultPageContent — the default hero / insights / projects / where / contact from
// page-content.js. A new instance's first visit returns this; the owner's first save in
// admin overwrites it.
func DefaultPageContent(ownerID string) entity.PageContent {
	return buildDefaultPage(ownerID)
}

func buildDefaultPage(ownerID string) entity.PageContent {
	return entity.PageContent{
		OwnerID:      ownerID,
		HeroProse:    defaultHeroProse,
		HeroExamples: defaultHeroExamples(),
		Insights:     defaultInsights(),
		Projects:     defaultProjects(),
		Where:        defaultWhere(),
		Contact:      defaultContact(),
	}
}

// The default page content is a placeholder — the copy shown on a new instance's first
// visit. Once the owner edits any section in /admin/page, it's overwritten permanently.
// Keep this content generic and neutral — it appears on every self-hosted instance at
// once, so don't put real personal information in it.

// defaultHeroProse —— EMPTY on purpose (F-A-21). The hero prose is **visitor-facing** page content;
// its old default ("This is your StandMeet page. Open /admin/page to introduce yourself…") spoke to
// the OWNER, telling them to open an admin route — nonsensical/leaky to a visitor (esp. one who
// entered with a code and can't reach /admin). An unconfigured page shows no hero prose (visitors
// see nothing rather than owner onboarding copy); the owner's "set this up" nudge lives in the
// /admin/page editor, not on the public surface. og:description falls back to a neutral default
// when this is empty.
const defaultHeroProse = ""

func defaultHeroExamples() []string {
	return []string{
		"What are you working on?",
		"How do you spend your time?",
		"What have you written lately?",
	}
}

// defaultInsights / defaultProjects default to empty pin lists — a section shows only
// once the owner pins a published entry; an empty section doesn't render at all
// (the corpus-pinning empty-state rule).

func defaultInsights() []string {
	return []string{}
}

func defaultProjects() []string {
	return []string{}
}

// defaultWhere —— EMPTY on purpose (F-A-21 sweep). Like the hero prose, the where/status copy is
// visitor-facing; the old defaults ("Edit your location in /admin/page." / "Tell visitors what
// you're up to right now.") spoke to the OWNER. An unconfigured section shows nothing; the owner's
// nudge lives in the /admin/page editor.
func defaultWhere() entity.PageWhere {
	return entity.PageWhere{
		LocationLine: "",
		StatusProse:  "",
		LookingFor:   []string{},
		Closing:      "",
	}
}

func defaultContact() entity.PageContact {
	return entity.PageContact{
		Email:          "",
		ChatLine:       "Ask via the chat above.",
		RecruiterProse: "",
		CasualProse:    "",
	}
}
