// A minimal cordis provider block: publishes the `demoBase` service and nothing else.
// One member of the group-composition acceptance test (see cordis.patch.yml). Pairs with
// group-consumer.js.
module.exports = {
  name: 'group-provider',
  apply(ctx) {
    ctx.provide('demoBase', { ok: true })
  },
}
