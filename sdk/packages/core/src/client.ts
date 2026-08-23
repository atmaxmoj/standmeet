// client.ts —— createClient 工厂：给定 baseURL 返回一组业务方法。caller
// （Next.js SSR、React app、Web Component embed）只用 client 实例，不
// 自己写 fetch / URL 拼接。
//
// 设计上 client 是无状态轻量对象，每次方法调用都新发 fetch；session token
// 由 caller 自己保存，作为参数传进 streamMessage。
//
// baseURL 为空串时所有请求走相对路径（让 Next rewrites / app proxy
// 透传）；非空时走绝对路径（SSR、Web Component 在第三方域名下）。
//
// v1 单 owner instance —— page / wiki landing / session 等 API 都不带
// handle 参数：sole owner 直接在 server 端 resolve。

import type {
  PublicPageView,
  WikiLandingView,
  OutputLandingView,
  PublicSessionResponse,
  SessionMode,
  SSEEvent,
} from './types.js';

// ClientOptions —— createClient 的入参。baseURL 默认空串。
export interface ClientOptions {
  baseURL?: string;
  fetchImpl?: typeof fetch;
}

// IssueSessionInput —— 三种 session mode 统一入参。mode 决定哪些字段是必需的：
//   public —— 无字段
//   code   —— code (+ visitor_name optional)
//   byoai  —— byoai_provider（key / endpoint / model 不上传 server；browser
//             自己 vault 保管，chat header 里走）
export interface IssueSessionInput {
  mode: SessionMode;
  code?: string;
  visitor_name?: string;
  // member_id —— 上次拿到的 member id;带上凭 id 续会(尤其匿名者),失效后端
  // 自动退到按 visitor_name / 新建。
  member_id?: string;
  byoai_provider?: string;
  // captcha_token —— 一次通过校验的人机校验票。**它是解锁用的**：同一 IP 连续试错码超过
  // 阈值后后端会锁 15 分钟，而带上一张有效票就能立刻过（`code_guard.go` 的
  // `Locked = enabled && overThreshold && captchaFails`）。captcha 没开时后端不看这个字段。
  captcha_token?: string;
}

// BYOAIHeaders —— streamMessage 在 mode=byoai 时透传 4 个 header（**全部必填**，
// 缺任一 server 401）：
//   X-BYOAI-Provider —— preset name ('openai' / 'deepseek' / 'custom' / ...)
//   X-BYOAI-Endpoint —— base URL（不带 /v1/... 后缀）
//   X-BYOAI-Model    —— model id
//   X-BYOAI-Key      —— caller 用 session_token HKDF 派生 AES-256 key、AES-GCM
//                       封装 plaintext 后的 base64 (URL-safe no padding)
// SDK 不参与 key 封装；caller 负责。
export interface BYOAIHeaders {
  provider: string;
  endpoint: string;
  model: string;
  wrappedKey: string;
}

// StandMeetClient —— 业务接口。consumer 通过 createClient 拿到的实例
// 满足这个 shape；不直接暴露内部字段。
export interface StandMeetClient {
  fetchPage(): Promise<PublicPageView>;
  // fetchWikiLanding —— lang 可选:多语笔记按它选一面;这条笔记没有那一面就退回它的
  // 身份语言(`lang:`)。**是查询参数不是路径段** —— 不是每条笔记都有同一套语言。
  fetchWikiLanding(slug: string, lang?: string): Promise<WikiLandingView | null>;
  fetchOutputLanding(slug: string): Promise<OutputLandingView | null>;
  issueSession(input: IssueSessionInput): Promise<PublicSessionResponse>;
  streamMessage(
    conversationID: string,
    sessionToken: string,
    content: string,
    system: string,
    byoai?: BYOAIHeaders,
  ): AsyncGenerator<SSEEvent, void, unknown>;
  // composeSystem —— 这一场的 system prompt（fragment + persona）。一场拼一次，整场复用。
  // 收的是它**真正读的那两个字段**，不是整份颁发回执：接手一场已有 session 的页面
  // 手上只有存下来的那几项，而这里从来没用过 quota / members。
  composeSystem(session: SystemPromptSource): Promise<string>;
}

// TurnMsg —— 发给后端的一条历史消息（后端 `ChatRequestMsg` 的线上形状）。
export interface TurnMsg { role: 'user' | 'assistant'; content: string }

// maxHistoryMsgs —— 往回带多少条。够撑起指代（「他」「它」「那个」）和几轮追问，
// 又不至于让请求随会话无限长。
const maxHistoryMsgs = 24;

export function createClient(opts: ClientOptions = {}): StandMeetClient {
  const baseURL = opts.baseURL ?? '';
  const f = opts.fetchImpl ?? fetch;
  // histories —— 每个 conversation 一份逐字稿，**客户端自己记**（F-O-7）。
  //
  // 为什么不做成 `streamMessage` 的第 N 个参数：以前它连这个参数都没有，请求体里
  // `history: []` 是硬编码，于是 SDK 的**三个面**（核心客户端、web component、React 绑定）
  // 全都在发一场没有记忆的对话 —— 第二问里的「他」「它」指谁，模型说它不知道。
  // 加个参数只是把「记得传」变成每个调用方的纪律，而这条纪律刚刚已经被三个调用方同时违反
  // 过一次（[[structure-means-no-responsibility-class]]）。所以记忆归客户端，调用方想忘也忘不了。
  const histories = new Map<string, TurnMsg[]>();
  return {
    fetchPage: () => fetchPage(f, baseURL),
    fetchWikiLanding: (slug, lang) => fetchWikiLanding(f, baseURL, slug, lang),
    fetchOutputLanding: (slug) => fetchOutputLanding(f, baseURL, slug),
    issueSession: (input) => issueSession(f, baseURL, input),
    streamMessage: (id, token, content, system, byoai) =>
      streamMessage(f, baseURL, id, token, content, system, byoai, histories),
    composeSystem: (session) => composeSystem(f, baseURL, session),
  };
}

// rememberTurn —— 一轮说完之后把「问 + 答」接进这场的逐字稿，超长从头截。
function rememberTurn(
  histories: Map<string, TurnMsg[]>, id: string, question: string, answer: string,
): void {
  if (answer === '') return; // 没答成的一轮不进历史：下一轮不该背着半截空回合走
  const next = [...(histories.get(id) ?? []),
    { role: 'user' as const, content: question },
    { role: 'assistant' as const, content: answer }];
  histories.set(id, next.slice(-maxHistoryMsgs));
}

async function fetchPage(f: typeof fetch, baseURL: string): Promise<PublicPageView> {
  const res = await f(`${baseURL}/api/v1/page`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch page: ${res.status}`);
  return (await res.json()) as PublicPageView;
}

async function fetchWikiLanding(
  f: typeof fetch, baseURL: string, slug: string, lang?: string,
): Promise<WikiLandingView | null> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await f(`${baseURL}/api/v1/wiki/${slug}${q}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch wiki ${slug}: ${res.status}`);
  return (await res.json()) as WikiLandingView;
}

async function fetchOutputLanding(
  f: typeof fetch, baseURL: string, slug: string,
): Promise<OutputLandingView | null> {
  const res = await f(`${baseURL}/api/v1/output/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch output ${slug}: ${res.status}`);
  return (await res.json()) as OutputLandingView;
}

async function issueSession(
  f: typeof fetch, baseURL: string, input: IssueSessionInput,
): Promise<PublicSessionResponse> {
  const res = await f(`${baseURL}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // 后端的错误信封是 `{"error":{"code","message"}}`,而上一版读的是顶层 `body.code` ——
    // 那个字段根本不存在,于是 code 永远是空串,message 一路被丢掉。信封里那句
    // 「this code is full — no more names available」是**写给访客看的**,却从来没到过屏幕上:
    // gate 只剩一个布尔,把每一种失败都说成 "unknown code",拿着有效邀请、只是名额满了的人
    // 被告知他的码不存在(F-A-23)。code 和 message 都带上。
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: unknown; message?: unknown };
    };
    const env = body.error ?? {};
    throw Object.assign(new Error(`issue session: ${res.status}`), {
      status: res.status,
      code: typeof env.code === 'string' ? env.code : '',
      serverMessage: typeof env.message === 'string' ? env.message : '',
    });
  }
  return (await res.json()) as PublicSessionResponse;
}

// streamMessage —— 一轮对话，走 **POST /api/v1/agent/turn**：跟 owner 自己那张页面同一条路。
//
// 它以前打的是 `/api/v1/llm/chat/stream`，body 里 `system: ''`，注释还写着 "No tool loop; this
// is a single-turn smoke test path" —— 那条路是**已退役**的裸模型代理（backend 的
// routes/public/chat.go:109-110 说得很清楚：SDK 切过来之后它就退役）。app 那半边早就切了，
// SDK 这半边没跟：于是**发出去给别人嵌进自己站点的那个组件**，没有检索、没有工具、没有人格 ——
// 在异源页面上问「这个语料是干什么的」，答回来的是一段 NLP 教科书定义（F-O-2）。
//
// system 由调用方传：它得先 `composeSystem(session)` 把这一场的 fragment + persona 拼出来。
// 不在这里偷偷拼，是因为那要多打几个 HTTP，调用方通常一场只拼一次、复用整场。
async function* streamMessage(
  f: typeof fetch, baseURL: string,
  conversationID: string, sessionToken: string, content: string,
  system: string, byoai: BYOAIHeaders | undefined,
  histories: Map<string, TurnMsg[]>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const res = await f(`${baseURL}/api/v1/agent/turn`, {
    method: 'POST',
    headers: buildMessageHeaders(sessionToken, byoai),
    body: JSON.stringify({
      system,
      user_message: content,
      conversation_id: conversationID,
      // 这一场之前说过的话（F-O-7）。后端拿 `req.History` 拼模型消息，**不会**按
      // conversation_id 回补 —— 这里空着，模型就永远在回答一场刚开始的对话。
      history: histories.get(conversationID) ?? [],
    }),
  });
  // 状态码挂在 error 上，不只是拼进 message（F-O-5）。
  //
  // 调用方要**分类**才能说对话：429 是「这一场正忙着」——上一轮还在流，等它完再问；
  // 其余是别的事。以前这里只 `new Error('send message: 429')`，于是 embed 那侧只有一个
  // catch，把所有失败塌成一句「没发出去，再试一次」——**发出去了，而且立刻再试只会再被拒**
  // （[[collapsed-error-class-kills-its-own-branch]]）。
  // 同一个文件里的 `issueSession` 早就是这么做的；这条只是没跟上。
  if (!res.ok || !res.body) {
    throw Object.assign(new Error(`send message: ${res.status}`), { status: res.status });
  }
  // 边流边攒这一轮的答案，收场时接进逐字稿 —— 下一轮就带着它走。
  let answer = '';
  for await (const ev of translateAgentSSE(res.body)) {
    if (ev.kind === 'token') answer += ev.text;
    yield ev;
  }
  rememberTurn(histories, conversationID, content, answer);
}

// composeSystem —— 这一场的 system prompt：先按 `system_prompt_part_ids` 逐段取回固定
// fragment（visitor-header + 每个能力一段），再把这一场**动态**的那一段 persona 接在后面
// （role 人格 + 这张码自己的 prompt + 授权 skill 的清单）。顺序要紧：persona 是 owner 为这个
// 受众写的东西，压在通用说明之上 —— 跟 agent-core 里那条路一模一样，只是那边给的是 React 宿主。
// SystemPromptSource —— 拼这一场 system prompt 要的全部输入。
export interface SystemPromptSource {
  readonly system_prompt_part_ids?: readonly string[];
  readonly system_prompt_persona?: string;
}

async function composeSystem(
  f: typeof fetch, baseURL: string, session: SystemPromptSource,
): Promise<string> {
  const parts: string[] = [];
  for (const id of session.system_prompt_part_ids ?? []) {
    // 每段一个路径**段**地编码：id 长这样 `capabilities/corpus.retrieval`,整串 encode 会把
    // 斜杠变成 %2F,路由匹配不上 → 404 → 这一段静默丢掉,模型少收到一整块说明。
    const path = id.split('/').map(encodeURIComponent).join('/');
    const res = await f(`${baseURL}/api/v1/prompts/${path}`);
    if (res.ok) parts.push((await res.text()).trim());
  }
  const persona = (session.system_prompt_persona ?? '').trim();
  if (persona !== '') parts.push(persona);
  return parts.filter((p) => p !== '').join('\n\n');
}

// translateAgentSSE —— agent turn 的 SSE → 这个 SDK 的事件。`text` / `done` / `error` 三种直接
// 对上；agent 路还会发 `tool_started` / `tool_completed` / `ghost` / `retrying`，**这个最简消费者
// 先忽略**（embed 只渲文字）。忽略不等于丢：要渲工具卡的宿主该用 agent-core 那条路。
//
// **`done` 一到就收工，并且把连接放掉**（F-A-42）。以前这里读到 EOF 才结束 —— 而后端在
// `done` 之后还要跑 epilogue（ghost 是一次真的 LLM 调用，prod 上实测 10–26 秒），流当然
// 还开着。于是调用方的 `for await` 一直不返回，widget 的输入框跟着多锁了那么久：
// **拿流的寿命当轮的寿命**（[[nonunique-signal-not-a-receipt]]）。
// 这个最简消费者本来就不渲 ghost，替一条它要丢掉的帧握着别人页面上的一条连接毫无道理。
// 要 ghost / 工具卡的宿主走 agent-core 那条路，那边自己读到流末尾。
async function* translateAgentSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.at(-1) ?? '';
    for (let i = 0; i < parts.length - 1; i++) {
      const ev = parseFrameToToken(parts[i] ?? '');
      if (ev === null) continue;
      yield ev;
      if (ev.kind === 'done') {
        await reader.cancel();
        return;
      }
    }
  }
}

function parseFrameToToken(raw: string): SSEEvent | null {
  let evType = ''; let evData = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) evType = line.slice(7).trim();
    else if (line.startsWith('data: ')) evData = line.slice(6).trim();
  }
  if (evType === 'text') {
    const d = safeParse(evData) as { delta?: string };
    if (d.delta) return { kind: 'token', text: d.delta };
    return null;
  }
  if (evType === 'done') {
    return {
      kind: 'done',
      cited_wiki_ids: [], cited_output_ids: [],
      cited_wiki_refs: [], cited_output_refs: [],
    };
  }
  if (evType === 'error') {
    const d = safeParse(evData) as { message?: string; code?: string };
    return { kind: 'error', code: d.code ?? 'inference_error', message: d.message ?? 'error' };
  }
  return null;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

function buildMessageHeaders(
  sessionToken: string, byoai: BYOAIHeaders | undefined,
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };
  return byoai
    ? {
      ...base,
      'X-BYOAI-Provider': byoai.provider,
      'X-BYOAI-Endpoint': byoai.endpoint,
      'X-BYOAI-Model': byoai.model,
      'X-BYOAI-Key': byoai.wrappedKey,
    }
    : base;
}
