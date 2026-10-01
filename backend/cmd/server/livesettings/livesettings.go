// Package livesettings —— the running copy of the owner's instance settings (internal hosts, the
// Turnstile login check, the skill catalogue).
//
// The settings are owner settings on /admin/system, stored in instance_settings; they used to be
// env vars read once at boot. A write reloads this copy at once; a copy older than maxAge is
// re-read on its next use, so a change made outside this process (another replica, a restore, a
// reset) reaches it within seconds too.
//
// Unsealing the Turnstile secret happens here, in the composition root: the owner domain only
// seals.
package livesettings

import (
	"context"
	"log/slog"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
)

// maxAge —— how old the copy may be before its next use re-reads the stored settings.
const maxAge = 2 * time.Second

// reloadTimeout —— how long a re-read may hold the request that triggered it.
const reloadTimeout = 3 * time.Second

// Settings —— the running copy.
type Settings struct {
	log       *slog.Logger
	instances *owner.InstanceRepo
	cur       atomic.Pointer[snapshot]
	mu        sync.Mutex // one re-read at a time
}

type snapshot struct {
	loadedAt  time.Time
	hosts     map[string]bool
	siteKey   string
	secret    string
	catalogue string
}

// New —— an empty copy (everything off) until Start loads it. The outbound guards ask it which
// internal hosts the owner allows.
func New(log *slog.Logger, instances *owner.InstanceRepo) *Settings {
	s := &Settings{log: log, instances: instances}
	s.cur.Store(&snapshot{hosts: map[string]bool{}})
	httpx.SetInternalHostSource(s.AllowsHost)
	return s
}

// Start —— at boot, after the schema is migrated: import an upgraded instance's old env once,
// then load the copy.
func (s *Settings) Start(ctx context.Context) error {
	plain := owner.InstanceConfigDeps{Instances: s.instances}
	if err := owner.ImportLegacyEnv(ctx, plain, legacyEnv()); err != nil {
		return err
	}
	s.Reload(ctx)
	return nil
}

// Reload —— read the stored settings into the running copy. A failed read keeps the last values
// (and waits maxAge before trying again).
func (s *Settings) Reload(ctx context.Context) {
	c, err := owner.GetInstanceConfig(ctx, owner.InstanceConfigDeps{Instances: s.instances})
	if err != nil {
		s.log.Error("instance settings: reload failed; keeping the running copy", "err", err)
		kept := *s.cur.Load()
		kept.loadedAt = time.Now()
		s.cur.Store(&kept)
		return
	}
	hosts := make(map[string]bool, len(c.InternalHosts))
	for _, h := range c.InternalHosts {
		hosts[h] = true
	}
	s.cur.Store(&snapshot{
		loadedAt: time.Now(), hosts: hosts, siteKey: c.CaptchaSiteKey,
		secret: s.unseal(c.CaptchaSecretEnc), catalogue: c.SkillCatalogueURL,
	})
}

// AllowsHost —— the owner lists this (lower-cased) host name as an internal host.
func (s *Settings) AllowsHost(host string) bool { return s.snap().hosts[host] }

// InternalHosts —— every internal host name the owner allows, for an outbound guard that runs
// outside this process (the openapi block refuses every other internal address itself).
func (s *Settings) InternalHosts() []string {
	hosts := s.snap().hosts
	out := make([]string, 0, len(hosts))
	for h := range hosts {
		out = append(out, h)
	}
	slices.Sort(out)
	return out
}

// Captcha —— the Turnstile pair; "" halves when unset.
func (s *Settings) Captcha() security.CaptchaPair {
	c := s.snap()
	return security.CaptchaPair{SiteKey: c.siteKey, Secret: c.secret}
}

// CaptchaOn —— the login check is on only when both halves are set.
func (s *Settings) CaptchaOn() bool {
	p := s.Captcha()
	return p.SiteKey != "" && p.Secret != ""
}

// CaptchaSiteKey —— the site key the pages render, "" while the check is off.
func (s *Settings) CaptchaSiteKey() string {
	if !s.CaptchaOn() {
		return ""
	}
	return s.snap().siteKey
}

// SkillCatalogue —— the catalogue the marketplace reads ("" = its default).
func (s *Settings) SkillCatalogue() string { return s.snap().catalogue }

// Deps —— what the settings ops write through: the repo, and Reload after every write.
func (s *Settings) Deps() owner.InstanceConfigDeps {
	return owner.InstanceConfigDeps{Instances: s.instances, Applied: s.Reload}
}

// snap —— the copy, re-read first when it is older than maxAge.
func (s *Settings) snap() *snapshot {
	if c := s.cur.Load(); time.Since(c.loadedAt) < maxAge {
		return c
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if c := s.cur.Load(); time.Since(c.loadedAt) < maxAge {
		return c // another caller re-read it while this one waited
	}
	ctx, cancel := context.WithTimeout(context.Background(), reloadTimeout)
	defer cancel()
	s.Reload(ctx)
	return s.cur.Load()
}

func (s *Settings) unseal(enc []byte) string {
	if len(enc) == 0 {
		return ""
	}
	plain, err := cryptobox.Decrypt(enc, []byte(owner.CaptchaSecretAAD))
	if err != nil {
		// The login check stays off rather than failing every login; the panel still says a
		// secret is stored, and saving it again repairs it.
		s.log.Error("instance settings: cannot unseal the Turnstile secret", "err", err)
		return ""
	}
	return string(plain)
}

// legacyEnv —— the env vars an upgraded instance's old compose still carries. Read only for the
// one-time import (owner.ImportLegacyEnv); a new deployment sets none of them.
func legacyEnv() *owner.LegacyEnv {
	hosts := splitList(os.Getenv("EGRESS_ALLOW_HOSTS"))
	hosts = append(hosts, splitList(os.Getenv("SUPPLIER_EGRESS_ALLOW"))...)
	return &owner.LegacyEnv{
		CaptchaSiteKey:    os.Getenv("TURNSTILE_SITE_KEY"),
		CaptchaSecret:     os.Getenv("TURNSTILE_SECRET"),
		InternalHosts:     hosts,
		SkillCatalogueURL: os.Getenv("MARKETPLACE_GITHUB_BASE_URL"),
	}
}

func splitList(s string) []string {
	out := []string{}
	for p := range strings.SplitSeq(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
