// instance_config.go —— the owner's instance settings (/admin/system): internal hosts, the
// Turnstile login check, the skill catalogue. They were env vars; the owner's rule (2026-10-01) is
// that a deployment carries wiring, not settings.
//
// A write takes effect at once: Applied hands the running process the new settings (the
// composition root keeps the live copy the guards and clients read).

package usecase

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// CaptchaSecretAAD —— the AAD the Turnstile secret is sealed with (the repo seals, the composition
// root unseals with the same).
const CaptchaSecretAAD = repo.CaptchaSecretAAD

// ErrInvalidSetting —— a setting the owner typed cannot be used; the message says which.
var ErrInvalidSetting = errors.New("invalid setting")

// InstanceConfigDeps —— the dependencies of the instance settings.
type InstanceConfigDeps struct {
	Instances *repo.InstanceRepo
	// Applied —— called after every write, so the running process takes the settings at once.
	Applied func(ctx context.Context)
}

// InstanceConfigInput —— the internal hosts and the skill catalogue, as the owner typed them.
type InstanceConfigInput struct {
	SkillCatalogueURL string
	InternalHosts     []string
}

// CaptchaInput —— the Turnstile pair. The secret follows the AI key's three states: keep / set /
// clear (an omitted secret never clears a stored one).
type CaptchaInput struct {
	SiteKey      string
	Secret       string
	SecretChange KeyChange
}

// GetInstanceConfig —— the owner's instance settings.
func GetInstanceConfig(
	ctx context.Context, deps InstanceConfigDeps,
) (entity.InstanceConfig, error) {
	c, err := deps.Instances.GetConfig(ctx)
	if err != nil {
		return entity.InstanceConfig{}, fmt.Errorf("instance settings: %w", err)
	}
	return c, nil
}

// UpdateInstanceConfig —— write the internal hosts and the skill catalogue.
func UpdateInstanceConfig(
	ctx context.Context, deps InstanceConfigDeps, in *InstanceConfigInput,
) (entity.InstanceConfig, error) {
	hosts, herr := normalizeHosts(in.InternalHosts)
	if herr != nil {
		return entity.InstanceConfig{}, herr
	}
	catalogue, cerr := normalizeCatalogue(in.SkillCatalogueURL)
	if cerr != nil {
		return entity.InstanceConfig{}, cerr
	}
	if err := deps.Instances.SetHostsAndCatalogue(ctx, hosts, catalogue); err != nil {
		return entity.InstanceConfig{}, fmt.Errorf("instance settings: %w", err)
	}
	return appliedConfig(ctx, deps)
}

// UpdateCaptcha —— write the Turnstile pair. The check is on only when both halves are set.
func UpdateCaptcha(
	ctx context.Context, deps InstanceConfigDeps, in *CaptchaInput,
) (entity.InstanceConfig, error) {
	if err := deps.Instances.SetCaptchaSiteKey(ctx, strings.TrimSpace(in.SiteKey)); err != nil {
		return entity.InstanceConfig{}, fmt.Errorf("captcha: %w", err)
	}
	if err := writeCaptchaSecret(ctx, deps.Instances, in); err != nil {
		return entity.InstanceConfig{}, err
	}
	return appliedConfig(ctx, deps)
}

// LegacyEnv —— the settings an upgraded instance still carries as env vars in its old compose.
type LegacyEnv struct {
	CaptchaSiteKey    string
	CaptchaSecret     string
	SkillCatalogueURL string
	InternalHosts     []string
}

// ImportLegacyEnv —— once, at the first boot on the new schema: copy the old env into the fields
// still empty, then mark the import done. An owner who later clears a field in the UI must not have
// it refilled on the next restart. A fresh instance imports nothing and is marked done too.
func ImportLegacyEnv(ctx context.Context, deps InstanceConfigDeps, env *LegacyEnv) error {
	c, err := deps.Instances.GetConfig(ctx)
	if err != nil {
		return fmt.Errorf("legacy env import: %w", err)
	}
	if c.LegacyEnvImported {
		return nil
	}
	if ierr := importLegacy(ctx, deps.Instances, &c, env); ierr != nil {
		return ierr
	}
	if merr := deps.Instances.MarkLegacyEnvImported(ctx); merr != nil {
		return fmt.Errorf("legacy env import: %w", merr)
	}
	return nil
}

func importLegacy(
	ctx context.Context, instances *repo.InstanceRepo, c *entity.InstanceConfig, env *LegacyEnv,
) error {
	plain := InstanceConfigDeps{Instances: instances}
	if err := importHostsAndCatalogue(ctx, plain, c, env); err != nil {
		return err
	}
	return importCaptcha(ctx, plain, c, env)
}

func importHostsAndCatalogue(
	ctx context.Context, deps InstanceConfigDeps, c *entity.InstanceConfig, env *LegacyEnv,
) error {
	hosts, herr := normalizeHosts(env.InternalHosts)
	if herr != nil {
		hosts = nil // an old list the new rules refuse is not imported; the owner re-enters it
	}
	in := InstanceConfigInput{
		InternalHosts:     firstNonEmptyList(c.InternalHosts, hosts),
		SkillCatalogueURL: cmp.Or(c.SkillCatalogueURL, env.SkillCatalogueURL),
	}
	if _, err := UpdateInstanceConfig(ctx, deps, &in); err != nil {
		return fmt.Errorf("legacy env import: %w", err)
	}
	return nil
}

func importCaptcha(
	ctx context.Context, deps InstanceConfigDeps, c *entity.InstanceConfig, env *LegacyEnv,
) error {
	if !captchaUnset(c) || env.CaptchaSiteKey == "" || env.CaptchaSecret == "" {
		return nil
	}
	_, err := UpdateCaptcha(ctx, deps, &CaptchaInput{
		SiteKey: env.CaptchaSiteKey, SecretChange: KeySet, Secret: env.CaptchaSecret,
	})
	return err
}

func captchaUnset(c *entity.InstanceConfig) bool {
	return c.CaptchaSiteKey == "" && len(c.CaptchaSecretEnc) == 0
}

func appliedConfig(ctx context.Context, deps InstanceConfigDeps) (entity.InstanceConfig, error) {
	if deps.Applied != nil {
		deps.Applied(ctx)
	}
	return GetInstanceConfig(ctx, deps)
}

func writeCaptchaSecret(ctx context.Context, instances *repo.InstanceRepo, in *CaptchaInput) error {
	switch in.SecretChange {
	case KeyKeep:
		return nil
	case KeyClear:
		return instances.ClearCaptchaSecret(ctx)
	case KeySet:
		return setCaptchaSecret(ctx, instances, in.Secret)
	}
	return nil
}

func setCaptchaSecret(ctx context.Context, instances *repo.InstanceRepo, raw string) error {
	secret := strings.TrimSpace(raw)
	if secret == "" {
		return fmt.Errorf("%w: the Turnstile secret is empty", ErrInvalidSetting)
	}
	return instances.SealCaptchaSecret(ctx, secret)
}

// hostName —— a bare host name: letters, digits, dots, hyphens (no scheme, port or path).
var hostName = regexp.MustCompile(
	`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)

// normalizeHosts —— trimmed, lower-cased, de-duplicated, in the order typed; every entry a bare
// host name.
func normalizeHosts(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	for _, raw := range in {
		h := strings.ToLower(strings.TrimSpace(raw))
		if h == "" || slices.Contains(out, h) {
			continue
		}
		if !hostName.MatchString(h) {
			return nil, fmt.Errorf("%w: %q is not a host name (no scheme, port or path)",
				ErrInvalidSetting, raw)
		}
		out = append(out, h)
	}
	return out, nil
}

// errBadCatalogue —— the catalogue is neither empty nor an absolute http(s) address.
var errBadCatalogue = fmt.Errorf("%w: the skill catalogue must be an http(s) address",
	ErrInvalidSetting)

// normalizeCatalogue —— "" or an absolute http(s) URL.
func normalizeCatalogue(raw string) (string, error) {
	s := strings.TrimRight(strings.TrimSpace(raw), "/")
	if s == "" {
		return "", nil
	}
	u, err := url.Parse(s)
	if err != nil || !isWebURL(u) {
		return "", errBadCatalogue
	}
	return s, nil
}

func isWebURL(u *url.URL) bool {
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func firstNonEmptyList(a, b []string) []string {
	if len(a) > 0 {
		return a
	}
	return b
}
