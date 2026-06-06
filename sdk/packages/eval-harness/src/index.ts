// @standmeet/eval-harness —— public surface。
//
// 大多数 caller 走 bin/eval-harness CLI；programmatic 调用 (e.g. CI
// snapshot harness) 通过这些 export。

export { runScenario, type RunScenarioOptions, type RunScenarioResult } from './runner.js';
export {
  loadScenario,
  ScenarioInvalidError,
  type Scenario,
  type ScenarioCapability,
  type ScenarioToolBinding,
  type ScenarioToolSpec,
  type ScenarioScripted,
  type ScenarioScriptedStep,
  type ScenarioToolCall,
} from './scenario.js';
export { fsPromptSource, type FsPromptSourceOptions } from './adapters/prompts-fs.js';
export { staticCapabilityStateSource } from './adapters/caps-static.js';
export { cannedToolDispatcher, type CannedToolDispatcherOptions } from './adapters/tools-canned.js';
export { printObserver, type PrintObserverOptions } from './adapters/observer-print.js';
export { scriptedLLMStreamer } from './adapters/llm-scripted.js';
