// instance_config.go —— instance.settings / instance.settings_set / captcha.set: the owner's
// instance settings on /admin/system (internal hosts, the Turnstile login check, the skill
// catalogue). They were env vars in the deployment file.
//
// The Turnstile secret goes in, never comes out: the outbound shape has only "is one stored", and
// the op that carries it is panel-only (like ai_provider.set).

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func instanceConfigOps(deps usecase.InstanceConfigDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "instance.settings",
			Description: "Read the instance settings: internal hosts the instance may reach, the " +
				"skill catalogue the marketplace reads, whether the Turnstile check is on.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getInstanceConfig(deps),
		},
		{
			ID: "instance.settings_set",
			Description: "Set the internal hosts every outbound guard may reach (host names " +
				"only) and the skill catalogue URL ('' = public anthropics/skills). Immediate.",
			InputSchema: instanceConfigSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setInstanceConfig(deps),
		},
		{
			ID: "captcha.set",
			Description: "Set the Cloudflare Turnstile login check: site key and secret (sealed " +
				"at rest, never returned). The check is on only when both are set.",
			InputSchema: captchaSchema,
			Kind:        fp.Action,
			Reach:       fp.Only("carries a raw Turnstile secret", "admin"),
			Invoke:      setCaptcha(deps),
		},
	}
}

var (
	instanceConfigSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"internal_hosts":{"type":"array","items":{"type":"string"}},
			"skill_catalogue_url":{"type":"string"}
		}
	}`)

	captchaSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"site_key":{"type":"string"},
			"secret_change":{"type":"string","description":"'keep' | 'set' | 'clear'."},
			"secret":{"type":"string","description":"Read only when secret_change='set'."}
		}
	}`)
)

// instanceConfigOut —— outbound shape; the secret is reported only as stored-or-not.
type instanceConfigOut struct {
	SkillCatalogueURL       string   `json:"skill_catalogue_url"`
	CaptchaSiteKey          string   `json:"captcha_site_key"`
	InternalHosts           []string `json:"internal_hosts"`
	CaptchaSecretConfigured bool     `json:"captcha_secret_configured"`
	CaptchaOn               bool     `json:"captcha_on"`
}

func instanceConfigPayload(c *entity.InstanceConfig) instanceConfigOut {
	hosts := c.InternalHosts
	if hosts == nil {
		hosts = []string{}
	}
	stored := len(c.CaptchaSecretEnc) > 0
	return instanceConfigOut{
		InternalHosts: hosts, SkillCatalogueURL: c.SkillCatalogueURL,
		CaptchaSiteKey: c.CaptchaSiteKey, CaptchaSecretConfigured: stored,
		CaptchaOn: stored && c.CaptchaSiteKey != "",
	}
}

func getInstanceConfig(deps usecase.InstanceConfigDeps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		c, err := usecase.GetInstanceConfig(ctx, deps)
		return configResult(&c, err)
	}
}

type instanceConfigArgs struct {
	SkillCatalogueURL string   `json:"skill_catalogue_url"`
	InternalHosts     []string `json:"internal_hosts"`
}

func setInstanceConfig(deps usecase.InstanceConfigDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in instanceConfigArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		c, err := usecase.UpdateInstanceConfig(ctx, deps, &usecase.InstanceConfigInput{
			InternalHosts: in.InternalHosts, SkillCatalogueURL: in.SkillCatalogueURL,
		})
		return configResult(&c, err)
	}
}

type captchaArgs struct {
	SiteKey      string `json:"site_key"`
	SecretChange string `json:"secret_change"`
	Secret       string `json:"secret"`
}

func setCaptcha(deps usecase.InstanceConfigDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in captchaArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		c, err := usecase.UpdateCaptcha(ctx, deps, &usecase.CaptchaInput{
			SiteKey: in.SiteKey, SecretChange: keyChangeOf(in.SecretChange), Secret: in.Secret,
		})
		return configResult(&c, err)
	}
}

func configResult(c *entity.InstanceConfig, err error) (json.RawMessage, error) {
	if errors.Is(err, usecase.ErrInvalidSetting) {
		return nil, fp.BadInput(err.Error())
	}
	if err != nil {
		return nil, fp.OpErr("instance settings", err)
	}
	return json.Marshal(instanceConfigPayload(c))
}
