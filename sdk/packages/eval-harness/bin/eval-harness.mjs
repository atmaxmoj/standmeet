#!/usr/bin/env node
// eval-harness CLI —— `pnpm exec eval-harness run scenarios/foo.yml`
// 解析 argv 并调 runScenario。详细选项见 README。

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { loadScenario, runScenario } from '../dist/index.js';

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === undefined || cmd === '--help' || cmd === '-h') {
  printUsage();
  process.exit(0);
}

if (cmd === 'run') {
  await runCmd(argv.slice(1));
} else {
  console.error(`unknown command: ${cmd}`);
  printUsage();
  process.exit(2);
}

async function runCmd(args) {
  const file = args[0];
  if (!file) {
    console.error('usage: eval-harness run <scenario.yml> [--json transcript.jsonl] [--no-color]');
    process.exit(2);
  }
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    console.error(`scenario file not found: ${path}`);
    process.exit(2);
  }
  const jsonlPath = pickFlag(args, '--json');
  const color = !args.includes('--no-color');
  const promptRoot = pickFlag(args, '--prompt-root') ?? defaultPromptRoot();
  const fixtureRoot = pickFlag(args, '--fixture-root') ?? defaultFixtureRoot(path);

  let scenario;
  try {
    scenario = loadScenario(path);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const result = await runScenario({
    scenario, promptRoot, fixtureRoot, jsonlPath, color,
  });
  process.stdout.write(`\n═══ ${result.scenarioName} done ${result.hasError ? '(with errors)' : '✓'} ═══\n`);
  process.exit(result.hasError ? 1 : 0);
}

function pickFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

// 默认 prompt root —— 复用 prod backend/internal/prompts。
// CLI cwd 是 repo root 时找得到；不在 repo root 跑就用 --prompt-root 显式给。
function defaultPromptRoot() {
  const guess = resolve(process.cwd(), 'backend/internal/prompts');
  return existsSync(guess) ? guess : resolve(process.cwd());
}

// 默认 fixture root —— 跟 scenario 同目录的 sibling fixtures/。
function defaultFixtureRoot(scenarioPath) {
  return resolve(scenarioPath, '..', '..', 'fixtures');
}

function printUsage() {
  process.stdout.write(`
eval-harness — run StandMeet visitor agent scenarios against fs / canned / direct-LLM adapters.

Usage:
  eval-harness run <scenario.yml> [options]

Options:
  --json <path>          也写 JSONL 行到 path (一行一 event)
  --no-color             stdout 不带 ANSI 着色
  --prompt-root <path>   PromptSource 根目录 (默认 backend/internal/prompts)
  --fixture-root <path>  ToolDispatcher fixture 根目录 (默认 scenarios/../fixtures)

Examples:
  eval-harness run sdk/packages/eval-harness/scenarios/smoke-scripted.yml
  eval-harness run scenarios/visitor-asks-projects.yml --json out/projects.jsonl
`);
}
