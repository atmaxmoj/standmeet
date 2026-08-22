// openapi-mail-specs.ts —— 假 mail vendor 的 spec / binding 样本。
//
// 从 connector-openapi-mail.spec.ts 拆出来（那边到了行数闸）。它们是**数据**：
// 「一个 vendor 的文档长什么样」跟「这条用例断什么」是两件事。

/**
 * FORM_MAIL_SPEC —— 一个**声明表单编码**的 vendor（Mailgun 那一族）。
 *
 * 真世界里这不是少数派：Mailgun / Twilio / Stripe 的发信、发短信、收款端点收的都是
 * `application/x-www-form-urlencoded` 或 `multipart/form-data`，**JSON body 会被整个忽略**
 * （真 Mailgun 对一份 JSON 的回答是 `400 from parameter is missing`）。除了 requestBody 的
 * 媒体类型和端点，其余跟 SendGrid 式那份是同构的 —— 差别只有这一处，红才只可能指向它。
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
 * FORM_MAIL_BINDING —— 同一个契约 op，只是构造的是**平字段**（表单没有嵌套）。
 * id 从 body 里取 —— 真 Mailgun 就是这么回的，不在头里。
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
