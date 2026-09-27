#!/usr/bin/env node
// run.mjs —— the real-DSH acceptance driver behind `make dsh-plugin-test`.
//
// For each <name>.acceptance.yaml (or only the names given as arguments) it drives the plugin
// through the lifecycle DSH itself ships, in a throwaway DSH_HOME:
//   1. npm pack the subject directory (the artifact a user would install);
//   2. `dsh plugin --profile acceptance add <tarball>` — DSH's installer, which enforces the
//      plugin's @deepseek-ai/dsh peer range against the running version;
//   3. `dsh --profile acceptance --dump-config` — the expected rows are composed;
//   4. `dsh --profile acceptance --patch probe.patch.yml` — boot; the probe reports the
//      registered services and tools, runs the exercises, and exits through ctx.appExit;
//   5. `dsh plugin --profile acceptance remove <package>` — the bundle leaves the profile.
//
// The DSH version is the @deepseek-ai/dsh devDependency in ./package.json. That is the only pin.
import { spawn } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
// Any profile name must work: a block finds its installed directory through the running profile
// (ctx.get('profileContext')), never through a hardcoded profile path.
const PROFILE = 'acceptance'
const PEER = '@deepseek-ai/dsh'
const bin = join(here, 'node_modules', '.bin')
const dsh = join(bin, 'dsh')

const pinned = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')).devDependencies[PEER]
const installed = JSON.parse(await readFile(join(here, 'node_modules', PEER, 'package.json'), 'utf8')).version
if (installed !== pinned) {
  console.error(`[dsh-plugin-test] installed ${PEER} ${installed} does not match the pin ${pinned}; run npm install in ${here}`)
  process.exit(2)
}

// run —— one command; stdout and stderr go to <out>/<log>.log and are returned for assertions.
function run(command, args, { cwd, env, log, timeoutMs }) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref()
    }, timeoutMs)
    child.on('close', async code => {
      clearTimeout(timer)
      await appendFile(log, `$ ${command} ${args.join(' ')}\n# exit ${code}${timedOut ? ' (timed out)' : ''}\n--- stdout\n${stdout}\n--- stderr\n${stderr}\n`)
      resolvePromise({ code, stdout, stderr, timedOut })
    })
  })
}

// Cordis entry lists carry `!!js` scalars; keep them as plain strings.
const parseEntries = text => parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })

function collectIds(node, ids = new Set()) {
  if (Array.isArray(node)) node.forEach(item => collectIds(item, ids))
  else if (node !== null && typeof node === 'object') {
    if (typeof node.id === 'string') ids.add(node.id)
    Object.values(node).forEach(value => collectIds(value, ids))
  }
  return ids
}

async function runScenario(name) {
  const spec = parse(await readFile(join(here, `${name}.acceptance.yaml`), 'utf8'))
  const expect = { rows: [], services: [], tools: [], ...spec.expect }
  const exercise = spec.exercise ?? []
  const out = join(here, 'out', name)
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const root = await mkdtemp(join(tmpdir(), `standmeet-dsh-${name}-`))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const packages = join(root, 'packages')
  await Promise.all([home, workspace, packages].map(dir => mkdir(dir, { recursive: true })))
  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    // The pinned pnpm (./package.json) comes first: `dsh plugin` forwards to the pnpm on PATH, and
    // the profile's pnpm-workspace.yaml settings (nodeLinker: hoisted) need pnpm 10 or later.
    PATH: `${bin}:${process.env.PATH}`,
    // Our own plugins are trusted; do not stop on pnpm's dependency build-script approval.
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS: 'true',
  }
  const opts = (log, timeoutMs = 60_000) => ({ cwd: workspace, env, log: join(out, `${log}.log`), timeoutMs })
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  const profileManifest = async () => JSON.parse(await readFile(join(home, 'profiles', PROFILE, 'package.json'), 'utf8'))

  try {
    const subject = resolve(here, spec.subject.source)
    const manifest = JSON.parse(await readFile(join(subject, 'package.json'), 'utf8'))
    const pkg = manifest.name
    // A plugin without a DSH peer is admitted by every DSH version, so the range is required here.
    if (manifest.peerDependencies?.[PEER] === undefined) throw new Error(`${pkg} declares no peerDependencies["${PEER}"]`)

    const packed = await run('npm', ['pack', '--json', '--pack-destination', packages], { ...opts('pack', 120_000), cwd: subject })
    if (packed.code !== 0) throw new Error('npm pack failed (pack.log)')
    const tarball = join(packages, JSON.parse(packed.stdout)[0].filename)

    // subject.peers: local packages the subject names as peerDependencies (they are not on npm). The
    // profile provides them as dev dependencies: DSH selects only `dependencies` as bundle layers, so a
    // peer that is itself a bundle stays a plain package and its own patch does not apply.
    const peers = []
    for (const source of spec.subject.peers ?? []) {
      const peerPacked = await run('npm', ['pack', '--json', '--pack-destination', packages], { ...opts('pack', 120_000), cwd: resolve(here, source) })
      if (peerPacked.code !== 0) throw new Error(`npm pack failed for peer ${source} (pack.log)`)
      const [{ filename, name: peerName }] = JSON.parse(peerPacked.stdout)
      peers.push(peerName)
      const peerAdded = await run(dsh, ['plugin', '--profile', PROFILE, 'add', '--save-dev', join(packages, filename)], opts('install', 600_000))
      if (peerAdded.code !== 0) throw new Error(`dsh plugin add of peer ${source} failed with exit ${peerAdded.code} (install.log)`)
    }

    const added = await run(dsh, ['plugin', '--profile', PROFILE, 'add', tarball], opts('install', 600_000))
    if (added.code !== 0) throw new Error(`dsh plugin add failed with exit ${added.code} (install.log)`)
    const afterAdd = await profileManifest()
    check(afterAdd.dependencies?.[pkg] !== undefined, `install: ${pkg} is not a profile dependency`)
    check(afterAdd.dsh?.profile?.bundles?.includes(pkg), `install: ${pkg} is not in dsh.profile.bundles`)

    const dumped = await run(dsh, ['--profile', PROFILE, '--dump-config'], opts('dump-config'))
    if (dumped.code !== 0) throw new Error(`dsh --dump-config failed with exit ${dumped.code} (dump-config.log)`)
    const rows = collectIds(parseEntries(dumped.stdout))
    for (const row of expect.rows) check(rows.has(row), `rows: ${row} is not in the composed config`)

    const probeOutput = join(out, 'probe.json')
    const probe = { output: probeOutput, services: expect.services, tools: expect.tools, exercise, settleMs: 15_000, exerciseTimeoutMs: 30_000 }
    const booted = await run(dsh, ['--profile', PROFILE, '--patch', join(here, 'probe.patch.yml')],
      { ...opts('boot', 180_000), env: { ...env, STANDMEET_PROBE: JSON.stringify(probe) } })
    // DSH denies an incompatible plugin at startup and reports it on stderr instead of failing boot.
    check(!booted.stderr.includes('is incompatible with dsh'), 'boot: DSH denied a plugin as version-incompatible (boot.log)')
    const report = await readFile(probeOutput, 'utf8').then(JSON.parse, () => null)
    if (report === null) throw new Error(`boot: DSH exited ${booted.timedOut ? 'by timeout' : `with ${booted.code}`} before the probe reported (boot.log)`)
    check(booted.code === 0, `boot: DSH exited with ${booted.code} after the probe reported (boot.log)`)
    check(report.error === null, `boot: probe error: ${report.error}`)
    for (const service of expect.services) check(report.services[service] === true, `services: ${service} is not registered`)
    for (const tool of expect.tools) check(report.tools.includes(tool), `tools: ${tool} is not registered`)
    for (const [index, done] of report.exercises.entries()) {
      check(done.isError === false, `exercise ${index + 1}: ${done.tool} returned an error: ${JSON.stringify(done.content)}`)
    }
    check(report.exercises.length === exercise.length, `exercise: ${report.exercises.length} of ${exercise.length} ran`)

    const removed = await run(dsh, ['plugin', '--profile', PROFILE, 'remove', pkg, ...peers], opts('uninstall', 300_000))
    if (removed.code !== 0) throw new Error(`dsh plugin remove failed with exit ${removed.code} (uninstall.log)`)
    const afterRemove = await profileManifest()
    check(afterRemove.dependencies?.[pkg] === undefined, `uninstall: ${pkg} is still a profile dependency`)
    check(!afterRemove.dsh?.profile?.bundles?.includes(pkg), `uninstall: ${pkg} is still in dsh.profile.bundles`)
    const redumped = await run(dsh, ['--profile', PROFILE, '--dump-config'], opts('dump-config-after-uninstall'))
    const remaining = collectIds(parseEntries(redumped.stdout))
    // The base bundle's `tools` row proves the dump rendered, so a missing row below means removal.
    check(redumped.code === 0 && remaining.has('tools'), 'uninstall: the profile no longer composes (dump-config-after-uninstall.log)')
    for (const row of expect.rows) check(!remaining.has(row), `uninstall: row ${row} is still composed`)
  } catch (error) {
    failures.push(error.message)
  }

  if (failures.length === 0) await rm(root, { recursive: true, force: true })
  else failures.push(`logs: ${out}; DSH home kept at ${home}`)
  return failures
}

const names = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : (await readdir(here)).filter(file => file.endsWith('.acceptance.yaml')).map(file => file.slice(0, -'.acceptance.yaml'.length)).sort()
if (names.length === 0) {
  console.error(`[dsh-plugin-test] no *.acceptance.yaml in ${here}`)
  process.exit(2)
}
console.log(`[dsh-plugin-test] DSH ${installed}, ${names.length} plugin(s)`)
const failed = []
for (const name of names) {
  console.log(`[dsh-plugin-test] ${name} ...`)
  const failures = await runScenario(name)
  if (failures.length === 0) console.log(`[dsh-plugin-test] PASS ${name}`)
  else {
    failed.push(name)
    console.log(`[dsh-plugin-test] FAIL ${name}\n${failures.map(line => `    - ${line}`).join('\n')}`)
  }
}
console.log(`[dsh-plugin-test] ${names.length - failed.length} passed, ${failed.length} failed${failed.length > 0 ? `: ${failed.join(', ')}` : ''}`)
process.exit(failed.length === 0 ? 0 : 1)
