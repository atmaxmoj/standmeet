// A minimal cordis consumer block: injects `demoBase`, and only once that resolves can it publish
// the derived `demoDerived` service. The other member of the group-composition acceptance test.
//
// This is what makes the test prove group composition + dependency-ordered activation: the consumer
// is listed BEFORE the provider in the group (cordis.patch.yml), so it can only reach ACTIVE — and
// register demoDerived — if the loader resolves it by dependency (waits in PENDING for demoBase),
// not by list order. Assert demoDerived and you have proven the group's fiber ordering on real dsh.
module.exports = {
  name: 'group-consumer',
  inject: ['demoBase'],
  apply(ctx) {
    ctx.provide('demoDerived', { base: ctx.demoBase })
  },
}
