// upgrade.go — the "is there a newer version" half behind /admin/system's "upgrade"
// button: ReleaseChannel asks the image registry whether a newer version exists. It lives
// in the composition root, not the domain — the domain sees one narrow interface, and the
// outbound HTTP never enters the stats domain.
//
// The other half (pressing "redeploy") is the substrate-blind signal in upgrade_signal.go.

package port

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const upgradeHTTPBudget = 15 * time.Second

// ReleaseChannel — reads the list of released versions from an OCI image registry
// (anonymous pull token, public image).
type ReleaseChannel struct {
	http *http.Client
	base string
	repo string
}

// NewReleaseChannel — base is the registry's root ("https://ghcr.io"), repo looks like
// "atmaxmoj/standmeet-backend". base is configurable so dev/e2e can point it at the
// local mock: a use case that **only holds when reaching the public internet** would
// otherwise fail red, on an offline machine, in a way indistinguishable from the
// product being broken.
func NewReleaseChannel(base, repo string) *ReleaseChannel {
	return &ReleaseChannel{
		base: strings.TrimSuffix(base, "/"), repo: repo,
		http: httpx.NewClient(httpx.Options{Timeout: upgradeHTTPBudget}),
	}
}

// LatestVersion — the newest **release version** among what's published.
func (c *ReleaseChannel) LatestVersion(ctx context.Context) (string, error) {
	token, err := c.pullToken(ctx)
	if err != nil {
		return "", err
	}
	tags, err := c.tags(ctx, token)
	if err != nil {
		return "", err
	}
	return newest(tags), nil
}

// Newer — is candidate newer than current. A non-release version string (like the
// unstamped "dev") always returns false: when unsure, don't announce a new version —
// not the other way around. **But "can't compare" is a separate matter** — see Released.
func (c *ReleaseChannel) Newer(current, candidate string) bool {
	if !c.Released(current) || !c.Released(candidate) {
		return false
	}
	return compare(current, candidate) < 0
}

// Released — is this string a release version number. "Can't compare" and "already
// the newest" are two different things, and Newer's single bool can't tell them
// apart: an unstamped build would look identical to the newest version to it.
func (*ReleaseChannel) Released(version string) bool {
	return releaseTag.MatchString(version)
}

// pullToken — the anonymous pull token for a public image. Without it /v2/ always
// returns 401.
func (c *ReleaseChannel) pullToken(ctx context.Context) (string, error) {
	q := url.Values{"scope": {"repository:" + c.repo + ":pull"}}.Encode()
	res, err := c.okBody(ctx, c.base+"/token?"+q, "")
	if err != nil {
		return "", err
	}
	defer closeBody(res.Body)
	var body struct {
		Token string `json:"token"`
	}
	if derr := json.NewDecoder(res.Body).Decode(&body); derr != nil {
		return "", fmt.Errorf("release channel decode token: %w", derr)
	}
	return body.Token, nil
}

func (c *ReleaseChannel) tags(ctx context.Context, token string) ([]string, error) {
	res, err := c.okBody(ctx, c.base+"/v2/"+c.repo+"/tags/list", token)
	if err != nil {
		return nil, err
	}
	defer closeBody(res.Body)
	var body struct {
		Tags []string `json:"tags"`
	}
	if derr := json.NewDecoder(res.Body).Decode(&body); derr != nil {
		return nil, fmt.Errorf("release channel decode tags: %w", derr)
	}
	return body.Tags, nil
}

// okBody — fires the request + checks status, hands back the unread body.
// **Decoding doesn't happen here**: the caller knows what shape it wants, and
// "decode for everyone" can only be done via any — which is exactly why this
// codebase forbids it.
func (c *ReleaseChannel) okBody(ctx context.Context, u, token string) (*http.Response, error) {
	res, err := c.get(ctx, u, token)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		closeBody(res.Body)
		return nil, fmt.Errorf("release channel: registry answered %d", res.StatusCode)
	}
	return res, nil
}

// closeBody — the return value of closing the body after reading can't be acted on
// (the connection pool reclaims it regardless). Routed through a discard function
// rather than `_ =` because errcheck accepts this; also the only place to touch
// later if telemetry gets hooked in.
func closeBody(c io.Closer) { discardClose(c.Close()) }

func discardClose(_ error) {}

func (c *ReleaseChannel) get(ctx context.Context, u, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("release channel request: %w", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("release channel: %w", err)
	}
	return res, nil
}

// releaseTag — only recognizes `vN.N.N`. The registry also holds `latest` and
// `v0.1.1-dirty` (the one leaked out by `git describe --dirty`) — treating those as
// versions would make the instance announce a "new version" that shouldn't exist
// at all.
var releaseTag = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

// newest — compares numerically, not lexicographically: lexicographic order would
// put v0.1.10 before v0.1.9.
func newest(tags []string) string {
	var rel []string
	for _, t := range tags {
		if releaseTag.MatchString(t) {
			rel = append(rel, t)
		}
	}
	if len(rel) == 0 {
		return ""
	}
	slices.SortFunc(rel, compare)
	return rel[len(rel)-1]
}

// compare — which of a and b is older. Negative = a is older. Both have already
// passed releaseTag, so all three segments parse cleanly.
func compare(a, b string) int {
	pa, pb := parts(a), parts(b)
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] - pb[i]
		}
	}
	return 0
}

// parts — `v1.2.3` → [1 2 3]. The caller has already passed releaseTag, so all
// three segments are pure digits, meaning a parse failure can't happen here; if it
// somehow does, treat it as 0 rather than letting one bad tag wreck the whole
// comparison.
func parts(tag string) [3]int {
	var out [3]int
	for i, s := range strings.SplitN(strings.TrimPrefix(tag, "v"), ".", 3) {
		n, err := strconv.Atoi(s)
		out[i] = zeroOnErr(n, err)
	}
	return out
}

func zeroOnErr(n int, err error) int {
	if err != nil {
		return 0
	}
	return n
}
