// connector-security-specs.ts —— §8-H 安全契约用的内联 spec/binding/常量。从
// connector-security.spec.ts 抽出来守 max-lines。spec helper 返回 JSON 串（spec.ts 解回对象上传）。

// ── inlined sample/malicious specs (promote to fixtures when impl lands) ──────
//
// minimal-but-valid OpenAPI 3.0 base; tests clone it and swap `servers[].url`
// (or the oauth2 token/authorize URLs) to the internal address under test.
// Everything else is benign so a REJECT can only be attributed to the URL.

export const INTERNAL_SERVER_URLS = [
  'http://localhost:8000',          // the backend itself (loopback)
  'http://127.0.0.1/admin',         // loopback IP
  'http://169.254.169.254/latest/meta-data/', // cloud metadata (the classic SSRF target)
  'http://10.0.0.5/internal',       // RFC1918 private
  'http://192.168.1.1/router',      // RFC1918 private
  'http://[::1]:8000/v1',           // IPv6 loopback
  'http://metadata.google.internal/computeMetadata/v1/', // GCP metadata hostname
];

// SPEC_SSRF_SERVER —— a spec whose only "reach-out" surface is servers[].url.
// The apiKey scheme means assembly itself need not call out, but a freebusy-style
// consume would; the backend must refuse the internal base at validate or call time.
export function specWithServerURL(url: string): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'SSRF probe', version: '1.0.0' },
    servers: [{ url }],
    paths: {
      '/freebusy': {
        get: {
          operationId: 'freebusy.query',
          security: [{ apiKeyAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
    },
  });
}

// SPEC_SSRF_OAUTH_URLS —— a benign servers[] but malicious oauth2 token/authorize
// URLs. The OAuth dance fetches those server-side, so internal URLs there are the
// SSRF vector even when the API base looks fine.
export function specWithOAuthURLs(authorizeURL: string, tokenURL: string): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'OAuth SSRF probe', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/freebusy': {
        get: {
          operationId: 'freebusy.query',
          security: [{ oauth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: authorizeURL,
              tokenUrl: tokenURL,
              scopes: { read: 'read' },
            },
          },
        },
      },
    },
  });
}

// MOCK base — the programmable OAuth/HTTP mock. Consume-time SSRF specs point
// their public-looking base at a mock endpoint that 302-redirects to an internal
// address only WHEN CALLED, so they sail through any upload/connect-time static
// URL check and only reveal the internal hop at consume time.
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

// specConsumeRedirectsInternal —— servers[].url is a benign mock endpoint that,
// at call time, 302s to an internal address (the SSRF lands during the API call,
// not at validate time). apiKey scheme so upload+credentials succeed cleanly.
export function specConsumeRedirectsInternal(): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Consume-time SSRF probe', version: '1.0.0' },
    // benign allow-listed base (passes assemble); the mock 302s any path → 169.254.169.254 at runtime.
    servers: [{ url: 'http://job-board-mock:9000/__mock/ssrf/redirect-internal' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          security: [{ apiKeyAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/events': {
        post: {
          operationId: 'events.insert',
          security: [{ apiKeyAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
    },
  });
}

// specOAuthDanceRedirectsInternal —— authorize/token URLs are benign mock
// endpoints that, at dance time, redirect the callback / token exchange toward an
// internal address. Passes any static upload-time URL check; the internal hop only
// appears once the server-side dance follows the provider's redirect.
export function specOAuthDanceRedirectsInternal(): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'OAuth redirect SSRF probe', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          security: [{ oauth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/events': {
        post: {
          operationId: 'events.insert',
          security: [{ oauth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              // authorize is browser-followed (localhost mock); token is backend-dialed →
              // allow-listed job-board-mock so it assembles, then 302s the exchange inward.
              authorizationUrl: `${MOCK}/__mock/oauth/authorize?redirect=internal`,
              tokenUrl: 'http://job-board-mock:9000/__mock/oauth/token?redirect=internal',
              scopes: { read: 'read' },
            },
          },
        },
      },
    },
  });
}

// SPEC_BENIGN_APIKEY —— a fully valid public-base apiKey connector, used by the
// credential-leak + isolation tests (must assemble cleanly so we can store a
// secret and then prove it never echoes / never crosses owner scope).
export const BENIGN_API_KEY_SECRET = 'sk_live_uploaded_connector_secret_DO_NOT_LEAK_42';
export const SPEC_BENIGN_APIKEY = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Benign calendar', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/freebusy': {
      post: {
        operationId: 'freebusy.query',
        security: [{ apiKeyAuth: [] }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/events': {
      post: {
        operationId: 'events.insert',
        security: [{ apiKeyAuth: [] }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
  },
});

// BENIGN_BINDING —— 完整 calendar 绑定（list_busy + create_event），让良性连接器干净装配
// （凭据泄漏 / 隔离用例只需「建得起来 + 存得下凭据」，JSONata 取最简）。统一上传契约 {spec,binding}。
export const BENIGN_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: { op: 'freebusy.query', request: '{}', response: '{ "busy": [] }' },
    create_event: { op: 'events.insert', request: '{ "summary": summary }', response: '{ "id": id }' },
  },
};
