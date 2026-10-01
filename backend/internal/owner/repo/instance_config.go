// instance_config.go —— reads and writes of the owner's instance settings (instance_settings row).

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// GetConfig —— the owner's instance settings.
func (r *InstanceRepo) GetConfig(ctx context.Context) (entity.InstanceConfig, error) {
	row, err := db.New(r.pool).GetInstanceSettings(ctx)
	if err != nil {
		return entity.InstanceConfig{}, fmt.Errorf("get instance settings: %w", err)
	}
	hosts := []string{}
	if len(row.InternalHosts) > 0 {
		if uerr := json.Unmarshal(row.InternalHosts, &hosts); uerr != nil {
			return entity.InstanceConfig{}, fmt.Errorf("unmarshal internal hosts: %w", uerr)
		}
	}
	return entity.InstanceConfig{
		InternalHosts: hosts, SkillCatalogueURL: row.SkillCatalogueUrl,
		CaptchaSiteKey: row.CaptchaSiteKey, CaptchaSecretEnc: row.CaptchaSecretEnc,
		LegacyEnvImported: row.LegacyEnvImported,
	}, nil
}

// SetHostsAndCatalogue —— write the internal hosts and the skill catalogue.
func (r *InstanceRepo) SetHostsAndCatalogue(
	ctx context.Context, hosts []string, catalogue string,
) error {
	encoded, merr := json.Marshal(hosts)
	if merr != nil {
		return fmt.Errorf("marshal internal hosts: %w", merr)
	}
	if err := db.New(r.pool).SetInstanceOwnerSettings(ctx, db.SetInstanceOwnerSettingsParams{
		Column1: encoded, SkillCatalogueUrl: catalogue,
	}); err != nil {
		return fmt.Errorf("set instance settings: %w", err)
	}
	return nil
}

// SetCaptchaSiteKey —— write the Turnstile site key.
func (r *InstanceRepo) SetCaptchaSiteKey(ctx context.Context, siteKey string) error {
	if err := db.New(r.pool).SetCaptchaSiteKey(ctx, siteKey); err != nil {
		return fmt.Errorf("set captcha site key: %w", err)
	}
	return nil
}

// CaptchaSecretAAD —— the AAD the Turnstile secret is sealed with; the composition root unseals it
// with the same.
const CaptchaSecretAAD = "instance-captcha"

// SealCaptchaSecret —— seal the Turnstile secret and store it. Sealing happens here, like the AI
// provider key's: this domain seals, only the composition root unseals.
func (r *InstanceRepo) SealCaptchaSecret(ctx context.Context, secret string) error {
	enc, err := cryptobox.Encrypt([]byte(secret), []byte(CaptchaSecretAAD))
	if err != nil {
		return fmt.Errorf("seal captcha secret: %w", err)
	}
	return r.setCaptchaSecretEnc(ctx, enc)
}

// ClearCaptchaSecret —— remove the stored Turnstile secret (the check turns off).
func (r *InstanceRepo) ClearCaptchaSecret(ctx context.Context) error {
	return r.setCaptchaSecretEnc(ctx, nil)
}

func (r *InstanceRepo) setCaptchaSecretEnc(ctx context.Context, enc []byte) error {
	if err := db.New(r.pool).SetCaptchaSecret(ctx, enc); err != nil {
		return fmt.Errorf("set captcha secret: %w", err)
	}
	return nil
}

// MarkLegacyEnvImported —— the one-time env import has run.
func (r *InstanceRepo) MarkLegacyEnvImported(ctx context.Context) error {
	if err := db.New(r.pool).MarkLegacyEnvImported(ctx); err != nil {
		return fmt.Errorf("mark legacy env imported: %w", err)
	}
	return nil
}
