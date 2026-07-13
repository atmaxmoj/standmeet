// connector-builtin-credform.spec.ts —— F-C-2 regression guard (API level).
//
// Real-env verification found GET /api/admin/connectors/smtp/credential-form
// → 400 "invalid_manifest: unsupported openapi version \"\"": the builtin SMTP
// connector is kind=protocol (no OpenAPI spec), but DeriveCredentialForm ran
// openapi.ParseSpec unconditionally → the whole mail connector setup form
// couldn't render. Every existing connector-cred-form spec uploads an OpenAPI
// 3.0 spec; none loads the BUILTIN protocol connector's form — so it 400'd
// unnoticed while e2e stayed green. This drives the real endpoint.

import { test, expect } from '@/fixtures/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('connector · builtin protocol connector credential-form (F-C-2)', () => {
  test('GET /connectors/smtp/credential-form returns the smtp field form, not a 400',
    async ({ playwright }) => {
      resetInstance();
      const request = await playwright.request.newContext();
      await claim(request, findSetupToken(), OWNER);
      await login(request, OWNER.email, OWNER.password);

      const res = await request.get(`${BACKEND}/api/admin/connectors/smtp/credential-form`);
      expect(res.status(), 'protocol connector form must 200, not 400 invalid_manifest').toBe(200);
      const form = await res.json() as { auth_type: string; fields: { key: string }[] };
      expect(form.auth_type).toBe('smtp');
      const keys = form.fields.map((f) => f.key);
      // keys must mirror what the save path (smtpCredJSON) reads.
      expect(keys).toContain('host');
      expect(keys).toContain('password');
      expect(keys).toContain('from_address');
      await request.dispose();
    });
});
