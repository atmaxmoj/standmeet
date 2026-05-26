// provider-form.ts —— BYOAI panel + admin AIProviderPanel 共享的表单状态
// 推导逻辑。两个组件都是"选 provider → preset 默认填 endpoint；如果用户
// 改过就保留"这条规则；抽出来一份，组件只负责渲染。
//
// **model 字段不自动填**：preset 表已删 defaultModel，切 provider 时只
// 重置 endpoint。model 留给用户自己输（或点 "Load models" button 拉真实
// 列表）。这条改动是为了避免默认 model 过时 / 不可用而用户不自知。
//
// 设计选择：state 形态不强绑 lib/inference/presets.ts 的 InferencePreset
// 类型 —— admin 那边 preset 是 fetch 来的 server view (AIProviderPresetView)，
// 字段名也不一样 (base_url vs baseUrl)。这里走 PresetDefaults 一个最小
// 抽象，两边各自把自家 preset 形态 adapt 一下。

export interface PresetDefaults {
  endpoint: string;
}

// EMPTY_DEFAULTS —— 找不到 preset（如 custom）时的兜底，全空字符串。
export const EMPTY_DEFAULTS: PresetDefaults = { endpoint: '' };

// ProviderFormState —— provider 切换型表单的最小状态。lastDefaults 是"上次
// 自动填的 preset 默认值"，用于判断 endpoint 是否被用户手动改过。model
// 永远是用户输入，不参与 "自动重填" 逻辑。
export interface ProviderFormState {
  provider: string;
  endpoint: string;
  model: string;
  lastDefaults: PresetDefaults;
}

// initialProviderForm —— 初始化 form：把当前 provider 的 preset 默认 endpoint
// 灌进去，同时记到 lastDefaults。model 永远从空起步（用户手输 / Load models）。
export function initialProviderForm(
  provider: string, defaults: PresetDefaults,
): ProviderFormState {
  return {
    provider,
    endpoint: defaults.endpoint,
    model: '',
    lastDefaults: { endpoint: defaults.endpoint },
  };
}

// switchProvider —— 选 provider 时的 state transition：
//   - 用户改过 endpoint（prev 值 != 上次自动填的默认）就保留 user value
//   - 没改过就重填新 preset 默认 endpoint
//   - lastDefaults 永远更新到新 preset 默认 endpoint（下次切换的判断基线）
//   - model 直接清空 —— provider 变了上一个 model id 几乎肯定不适用
export function switchProvider(
  prev: ProviderFormState, provider: string, next: PresetDefaults,
): ProviderFormState {
  const endpoint = pickEndpoint(prev, next);
  return {
    provider, endpoint, model: '',
    lastDefaults: { endpoint: next.endpoint },
  };
}

function pickEndpoint(prev: ProviderFormState, next: PresetDefaults): string {
  return prev.endpoint === prev.lastDefaults.endpoint ? next.endpoint : prev.endpoint;
}

// setEndpoint / setModel —— 单字段更新，让组件不用手写 spread。
export function setEndpoint(prev: ProviderFormState, v: string): ProviderFormState {
  return { ...prev, endpoint: v };
}

export function setModel(prev: ProviderFormState, v: string): ProviderFormState {
  return { ...prev, model: v };
}
