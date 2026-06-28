// connector-jsonata.ts —— §8-C 绑定契约用的内联 spec + 各 JSONata 绑定（happy / runtime / 坏）。
// 从 connector-binding-jsonata.spec.ts 抽出来守 max-lines。e2e 不碰真 Google：servers / oauth
// 端点指 job-board-mock 的 gcal 路由（backend 调的用 service-name，authorize 用 localhost）。

// SAMPLE_SPEC —— 最小但合法的 OpenAPI 3.0：freebusy.query / events.insert 两个 op + oauth2。
export const SAMPLE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample Calendar', version: '1.0.0' },
  servers: [{ url: 'http://job-board-mock:9000/google-calendar' }],
  paths: {
    '/freeBusy': {
      post: {
        operationId: 'freebusy.query',
        security: [{ oauth2: ['calendar.readonly'] }],
        responses: { '200': { description: 'free/busy' } },
      },
    },
    '/calendars/primary/events': {
      post: {
        operationId: 'events.insert',
        security: [{ oauth2: ['calendar.events'] }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', required: ['summary'] } } },
        },
        responses: { '200': { description: 'created event' } },
      },
    },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'http://localhost:9000/google-oauth/auth',
            tokenUrl: 'http://job-board-mock:9000/google-oauth/token',
            scopes: { 'calendar.readonly': 'read free/busy', 'calendar.events': 'write events' },
          },
        },
      },
    },
  },
} as const;

// SAMPLE_BINDING —— happy 绑定：list_busy/create_event 两向 JSONata。
export const SAMPLE_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: {
      op: 'freebusy.query',
      request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{ "id": "primary" }] }',
      response: '{ "busy": calendars.primary.busy.{ "start": start, "end": end } }',
    },
    create_event: {
      op: 'events.insert',
      request:
        '{ "summary": summary, "start": { "dateTime": start }, ' +
        '"end": { "dateTime": end }, "attendees": [{ "email": visitorEmail }] }',
      response: '{ "id": id, "htmlLink": htmlLink }',
    },
  },
} as const;

// NULL_REQUIRED_FIELD_BINDING —— summary 映到契约没有的字段 → 求值 null（必填却空，pre-flight 拒）。
export const NULL_REQUIRED_FIELD_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    create_event: { ...SAMPLE_BINDING.operations.create_event, request: '{ "summary": nonexistent_title, "start": { "dateTime": start }, "end": { "dateTime": end } }' },
  },
} as const;

// NESTED_ARRAY_BINDING —— busy 藏在 periods[].interval{from,to}，嵌套映射 + 重命名。
export const NESTED_ARRAY_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, response: '{ "busy": calendars.primary.periods.interval.{ "start": from, "end": to } }' },
  },
} as const;

// EXTRA_OP_BINDING —— 多绑一个 consumer 不要的 cancel_event（占位合法 op）→ 应容忍。
export const EXTRA_OP_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    cancel_event: { op: 'events.insert', request: '{ "id": eventId }', response: '{ "ok": true }' },
  },
} as const;

// BROKEN_JSONATA_BINDING —— response 缺右括号（装配期拒）。
export const BROKEN_JSONATA_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, response: 'calendars.primary.busy.{ "start": start' },
  },
} as const;

// GHOST_OP_BINDING —— 引用 spec 里不存在的 operationId（装配期拒）。
export const GHOST_OP_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, op: 'freebusy.nonexistent' },
  },
} as const;

// UNKNOWN_CATEGORY_BINDING —— 没有对应品类槽（装配期拒）。
export const UNKNOWN_CATEGORY_BINDING = { ...SAMPLE_BINDING, category: 'telepathy' } as const;

// INCOMPLETE_BINDING —— 漏映 create_event（calendar 契约不完整，装配期拒）。
export const INCOMPLETE_BINDING = {
  category: 'calendar', kind: 'openapi',
  operations: { list_busy: SAMPLE_BINDING.operations.list_busy },
} as const;
