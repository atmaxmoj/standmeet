// use-connector-upload —— #155 区 G 上传编排：贴 spec(+可选 binding) 装配一个 openapi 连接器。
// 重名（同品类已有）→ 先弹覆盖确认；确认 → 删旧建新（覆盖，不叠加）。品类从 binding 文本里抠
// （regex，不在前端跑 YAML parser）。逻辑住这里，presentation 只渲染。
//
// **装配是三步，不是一步**（F-C-21）：建连接器 → 拿到 id → 把 owner 在同一个表单里填的凭据
// 存进这个 id。少了第三步，token 那一格就是「填了没地方去」，而 UI 上看不出来。

import { useCallback, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';
import type { ConnectorListHook } from '@/lib/admin/use-connector-list';
import { useReportError } from '@/lib/ui/use-report-error';

// AssembleInput —— 一次装配收齐的全部东西。spec 之外的三样都可空：owner 拿到一份
// 声明齐全的 spec 时，binding / baseUrl / authScheme 都不必填。
export interface AssembleInput {
  spec: string;
  binding: string;
  baseUrl: string;
  authScheme: string;
  exposeAsAgentTools: boolean;
  credentials: Record<string, string>;
  // scopes —— oauth2 勾选的授权范围。跟凭据一起存；漏了它，授权跳转就少了范围。
  scopes: string[];
}

// isAssemblable —— 装出来的东西**有人能用吗**。两条出路各自成立：
//   binding → 填一个品类槽，归一 cap 走它；
//   exposeAsAgentTools → 接口直接开给访客的 AI（owner 明确勾选，设计源 §3 的 opt-in）。
// 两条都没有 → 建出来是个死物，谁都调不到。规则住这里而不是组件里：它是装配的语义，
// 不是某个面的排版判断。
export function isAssemblable(input: AssembleInput): boolean {
  return input.binding.trim() !== '' || input.exposeAsAgentTools;
}

interface Pending { input: AssembleInput; category: string }

export interface ConnectorUploadHook {
  pending: Pending | null;
  // createdID —— 刚装配出来的连接器 id。owner 装配完不是就完事了：还要填凭据、点 Connect，
  // 而那两件事一直是 ConnectorCard 的职责。没有这个 id，owner 会落在一个**连不上**的列表行上
  // （ConnectorList 的行只有品类/状态/删除，没有 Connect）—— 正是 F-C-21 那种「一路给正反馈，
  // 到头来没有出口」。
  createdID: string | null;
  // resetCreated —— 把「刚装配出来的那个」清掉。**再次打开「添加连接器」必须是干净的**：
  // 不清的话，摄入表单会一直让位给上一次那张卡，spec 输入框永远不再出现（装第二个连接器
  // 就此无门）。createdID 属于一次模态会话，不属于这个页面。
  resetCreated: () => void;
  upload: (input: AssembleInput) => void;
  confirmOverwrite: () => void;
  cancelOverwrite: () => void;
}

// bindingCategory —— 从 binding YAML 文本抠 category（`category: calendar`）。
function bindingCategory(binding: string): string {
  return binding.match(/^\s*category:\s*["']?([\w.-]+)/m)?.[1] ?? '';
}

// hasValue —— 至少填了一个非空凭据字段才去存。全空还 POST 的话，会把一个「什么都没填」
// 的凭据写成一次真实保存，之后 owner 看到的是「已配置」而其实是空的。
function hasValue(creds: Record<string, string>): boolean {
  return Object.values(creds).some((v) => v.trim() !== '');
}

export function useConnectorUpload(list: ConnectorListHook): ConnectorUploadHook {
  const [pending, setPending] = useState<Pending | null>(null);
  const [createdID, setCreatedID] = useState<string | null>(null);
  const report = useReportError();

  // assemble —— 建 + 存凭据。任一步失败都 report：装配没成而界面不吭声，是这个面上最坏的结局。
  const assemble = useCallback(async (input: AssembleInput) => {
    const id = await list.create({
      specText: input.spec, bindingText: input.binding,
      baseUrl: input.baseUrl, authScheme: input.authScheme,
      exposeAsAgentTools: input.exposeAsAgentTools,
    });
    setCreatedID(id);
    // body 是**扁平的**字段名→值 + scopes（跟 use-connector-card 的 saveCreds 同一个形状；那边是
    // 这条路上唯一已经跑通的写法，形状对不上的话凭据会静默地存成空）。
    if (hasValue(input.credentials)) {
      await adminAPI.postVoid(`/connectors/${id}/credentials`, {
        ...input.credentials, scopes: input.scopes,
      });
    }
    list.refresh();
  }, [list]);

  const upload = useCallback((input: AssembleInput) => {
    const category = bindingCategory(input.binding);
    const exists = category !== '' && list.connectors.some((c) => c.category === category);
    exists
      ? setPending({ input, category })
      : void assemble(input).catch(report);
  }, [assemble, list.connectors, report]);

  const confirmOverwrite = useCallback(() => {
    const p = pending;
    const old = p === null ? undefined : list.connectors.find((c) => c.category === p.category);
    void (old === undefined ? Promise.resolve() : list.remove(old.id))
      .then(() => (p === null ? undefined : assemble(p.input)))
      .catch(report) // 删旧/建新任一步失败 → report 反显（覆盖没生效 owner 必须知道）。
      .finally(() => setPending(null)); // 成败都收起确认框：失败也别把对话框卡死。
  }, [pending, list, assemble, report]);

  const cancelOverwrite = useCallback(() => setPending(null), []);

  const resetCreated = useCallback(() => setCreatedID(null), []);

  return { pending, createdID, resetCreated, upload, confirmOverwrite, cancelOverwrite };
}
