// connector-jsonata.ts —— the inline spec + the JSONata bindings (happy / runtime /
// broken) for the §8-C binding contract. Extracted from
// connector-binding-jsonata.spec.ts to stay under max-lines. e2e never touches
// real Google: the servers / oauth endpoints point at external-mock's gcal routes
// (backend-dialed ones use the service-name, authorize uses localhost).

// SAMPLE_SPEC —— minimal but valid OpenAPI 3.0: two ops freebusy.query /
// events.insert + oauth2.
export const SAMPLE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample Calendar', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/google-calendar' }],
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
            tokenUrl: 'http://external-mock:9000/google-oauth/token',
            scopes: { 'calendar.readonly': 'read free/busy', 'calendar.events': 'write events' },
          },
        },
      },
    },
  },
} as const;

// SAMPLE_BINDING —— the happy binding: two-way JSONata for list_busy/create_event.
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

// NULL_REQUIRED_FIELD_BINDING —— summary maps to a field the contract doesn't have
// → evaluates to null (required but empty, rejected at pre-flight).
export const NULL_REQUIRED_FIELD_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    create_event: { ...SAMPLE_BINDING.operations.create_event, request: '{ "summary": nonexistent_title, "start": { "dateTime": start }, "end": { "dateTime": end } }' },
  },
} as const;

// NESTED_ARRAY_BINDING —— busy is buried in periods[].interval{from,to}, nested
// mapping + rename.
export const NESTED_ARRAY_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, response: '{ "busy": calendars.primary.periods.interval.{ "start": from, "end": to } }' },
  },
} as const;

// EXTRA_OP_BINDING —— binds an extra cancel_event the consumer doesn't need (a
// placeholder valid op) → should be tolerated.
export const EXTRA_OP_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    cancel_event: { op: 'events.insert', request: '{ "id": eventId }', response: '{ "ok": true }' },
  },
} as const;

// BROKEN_JSONATA_BINDING —— response is missing a closing brace (rejected at assembly).
export const BROKEN_JSONATA_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, response: 'calendars.primary.busy.{ "start": start' },
  },
} as const;

// GHOST_OP_BINDING —— references an operationId that doesn't exist in the spec
// (rejected at assembly).
export const GHOST_OP_BINDING = {
  ...SAMPLE_BINDING,
  operations: {
    ...SAMPLE_BINDING.operations,
    list_busy: { ...SAMPLE_BINDING.operations.list_busy, op: 'freebusy.nonexistent' },
  },
} as const;

// UNKNOWN_CATEGORY_BINDING —— no matching category slot (rejected at assembly).
export const UNKNOWN_CATEGORY_BINDING = { ...SAMPLE_BINDING, category: 'telepathy' } as const;

// INCOMPLETE_BINDING —— create_event is unmapped (the calendar contract is
// incomplete, rejected at assembly).
export const INCOMPLETE_BINDING = {
  category: 'calendar', kind: 'openapi',
  operations: { list_busy: SAMPLE_BINDING.operations.list_busy },
} as const;
