// openapi-mail-specs.ts —— sample spec / binding for a fake mail vendor.
//
// Extracted from connector-openapi-mail.spec.ts (which hit the line-count gate).
// They're **data**: "what a vendor's docs look like" and "what this case asserts"
// are two different things.

/**
 * FORM_MAIL_SPEC —— a vendor that **declares form encoding** (the Mailgun family).
 *
 * In the real world this isn't a minority: the send-mail, send-SMS, and take-payment
 * endpoints of Mailgun / Twilio / Stripe all accept
 * `application/x-www-form-urlencoded` or `multipart/form-data`, and **a JSON body is
 * ignored entirely** (real Mailgun's answer to a JSON payload is
 * `400 from parameter is missing`). Apart from the requestBody media type and the
 * endpoint, it's isomorphic to the SendGrid-style one —— the only difference is this
 * one spot, so a red can only point at it.
 */
export const FORM_MAIL_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Sample Mailgun-style Mail', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/__mock/mailapi' }],
  paths: {
    '/send-form': {
      post: {
        operationId: 'mail.send',
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  from: { type: 'string' }, to: { type: 'string' },
                  subject: { type: 'string' }, text: { type: 'string' },
                },
                required: ['from', 'to'],
              },
            },
          },
        },
        responses: { '200': { description: 'queued' }, '400': { description: 'missing field' } },
      },
    },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
} as const;

/**
 * FORM_MAIL_BINDING —— the same contract op, only it constructs **flat fields**
 * (forms have no nesting). id is taken from the body —— that's how real Mailgun
 * returns it, not in the headers.
 */
export const FORM_MAIL_BINDING = {
  category: 'mail',
  kind: 'openapi',
  operations: {
    send: {
      op: 'mail.send',
      request:
        '{ "from": "StandMeet Verify <verify@mock.test>", "to": to, ' +
        '"subject": subject, "text": body }',
      response: '{ "id": id }',
    },
  },
} as const;
