// instance_config.go —— the instance settings the owner sets on /admin/system.
//
// They were env vars in the deployment file (Turnstile keys, the two internal-host lists, the
// skill catalogue); the owner's rule (2026-10-01) is that a deployment carries wiring, not
// settings.

package entity

// InstanceConfig —— the owner's instance settings. Field order follows fieldalignment.
type InstanceConfig struct {
	// SkillCatalogueURL —— the GitHub contents API base the skill marketplace reads; "" = default.
	SkillCatalogueURL string
	// CaptchaSiteKey —— the Turnstile site key (public).
	CaptchaSiteKey string
	// InternalHosts —— host names every outbound guard may reach although they resolve to an
	// internal address.
	InternalHosts []string
	// CaptchaSecretEnc —— the Turnstile secret, sealed. This domain seals it and never unseals it.
	CaptchaSecretEnc []byte
	// LegacyEnvImported —— the one-time import of an upgraded instance's old env vars has run.
	LegacyEnvImported bool
}
