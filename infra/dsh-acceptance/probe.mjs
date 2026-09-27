// probe.mjs —— the in-process observer that run.mjs mounts through DSH's own `--patch` overlay
// (probe.patch.yml). DSH exposes no model-free "list tools / call tool" command, so the
// acceptance driver looks from inside the booted tree, the same place every tool plugin
// registers into (ctx.tools, from @deepseek-ai/dsh-tools).
//
// It waits for the launcher's appReady signal (committed only after the whole Loader tree
// settled), then records which expected services and tools are present, calls each declared
// exercise through ctx.tools.execute, writes one JSON file, and asks the launcher to exit
// through ctx.appExit (the launcher's bounded shutdown path, from @deepseek-ai/dsh-cmdline).
// The driver reads the JSON and makes every pass/fail decision.
import { writeFileSync } from 'node:fs'

export const name = 'standmeet-acceptance-probe'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export function apply(ctx) {
  const config = JSON.parse(process.env.STANDMEET_PROBE ?? 'null')
  if (config === null) throw new Error('STANDMEET_PROBE is required')
  ctx.get('appReady').onReady(() => void observe(ctx, config))
}

async function observe(ctx, config) {
  const result = { services: {}, tools: [], exercises: [], error: null }
  try {
    const toolNames = () => ctx.get('tools')?.schemas().map(schema => schema.name) ?? []
    // MCP-backed rows can publish their tools a moment after activation; poll until every
    // expected capability is present or the settle window ends.
    const deadline = Date.now() + config.settleMs
    while (Date.now() < deadline) {
      const names = toolNames()
      if (config.services.every(s => ctx.get(s) !== undefined) && config.tools.every(t => names.includes(t))) break
      await sleep(100)
    }
    for (const service of config.services) result.services[service] = ctx.get(service) !== undefined
    result.tools = toolNames()
    for (const [index, exercise] of config.exercise.entries()) {
      try {
        const outcome = await ctx.get('tools').execute({
          callId: `standmeet-acceptance-${index + 1}`,
          name: exercise.tool,
          arguments: exercise.arguments ?? {},
          signal: AbortSignal.timeout(config.exerciseTimeoutMs),
        })
        result.exercises.push({ tool: exercise.tool, isError: outcome.isError, content: outcome.content })
      } catch (error) {
        result.exercises.push({ tool: exercise.tool, isError: true, content: String(error?.stack ?? error) })
      }
    }
  } catch (error) {
    result.error = String(error?.stack ?? error)
  }
  writeFileSync(config.output, `${JSON.stringify(result, null, 2)}\n`)
  ctx.get('appExit')(0)
}
