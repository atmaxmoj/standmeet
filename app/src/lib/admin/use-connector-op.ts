// use-connector-op —— 跑一个连接器**自己声明**的 owner 操作(见后端 connector/owner_op.go)。
//
// 面不认识任何一个具体操作:名字、说明、要填哪几格,全从目录里那份声明来。这里只做两件事 ——
// 把 owner 填的值攒起来,POST 到那个操作的路由,然后把回来的东西变成**一个结果**给卡去渲。
//
// 失败那句话原样用后端给的:它在后端就已经归好类了(mailFailureReason —— 改配置 / 换收件人 /
// 等一会儿再试),措辞里没有状态码、主机名和栈。前端再包装一次只会把它冲淡。

import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

import type { OwnerOp } from '@/lib/admin/use-connector-catalog';
import { adminAPI } from '@/lib/api/admin';
import { APIError } from '@/lib/api/api-error';

// OP_PREFIX —— 声明的操作 id 统一以此开头,去掉就是路由段。跟后端 declaredOpPrefix
// (routes/admin/connectors.go)是同一条约定 —— 路由 `/connectors/ops/<段>` 本来就是公开的。
const OP_PREFIX = 'connectors.';

// OpResultSchema —— 每个操作回什么由它自己定,但共同的形状就这三样:成没成 / 没成的话一句
// 人话 / 成了的话是哪一路送出去的。别的字段这一层不认,也不该出现在面上。
const OpResultSchema = z.object({
  ok: z.boolean().nullish(),
  reason: z.string().nullish(),
  via_kind: z.string().nullish(),
  // summary —— 成了之后那一句,由**操作自己**说。以前只有 via_kind,而卡上那句成功文案是
  // 「被 {kind} 连接器收下了 —— 去收件箱确认」:邮件口吻长在了通用的那一层里,换个品类就是胡话
  // (日历自检没有收件箱)。给得出 summary 的操作用自己的话;给不出的仍走老那句。
  summary: z.string().nullish(),
});

// OpOutcome —— 跑完之后的结果。reason 是**后端的原话**;viaKind 是成时那一路的 kind。
//
// reached 单独一格,是因为「请求根本没走通」和「操作跑了但没成」是两件事:后者后端归过类,
// 前者它连收都没收到。塌成同一个 ok:false 的话,面上就会拿一句归类结果去解释一次断网。
export interface OpOutcome {
  reached: boolean;
  ok: boolean;
  reason: string;
  viaKind: string;
  summary: string;
}

export interface ConnectorOpHook {
  segment: string;
  running: boolean;
  outcome: OpOutcome | null;
  setField: (key: string, value: string, type: string) => void;
  run: () => void;
}

// coerce —— 按声明的类型把输入框里的字符串转回去。数字字段送字符串的话,op 自己的
// schema 第一步 unmarshal 就失败(F-C-17)。空串一律当没填,交给 op 的默认值。
function coerce(value: string, type: string): string | number | undefined {
  if (value === '') return undefined;
  if (type !== 'integer' && type !== 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// failedOutcome —— 这一笔为什么没成。**服务端答过话就不许说「够不着」**（F-C-37）。
//
// 以前这里是 `.catch(() => ({ reached: false … }))` —— 任何拒绝都算「请求没走通」，
// 包括一个 `400 to is required`：后端 33 毫秒就把原因说清楚了，屏幕却让 owner 去查网络，
// 而他要做的只是往那个框里填个地址。三态（没走通 / 跑了但没成 / 成了）是这个组件**设计
// 里就有的**（见 ConnectorOps 那段注释），塌在了唯一做判断的这一处。
//
// `APIError` 就是后端 envelope 的前端镜像（status + code + message），它在手里就说明
// **实例答过话**：那是「跑了但没成」，把它的话原样交出去。真正的传输失败没有 APIError。
function failedOutcome(e: unknown): OpOutcome {
  const answered = e instanceof APIError;
  return {
    reached: answered,
    ok: false,
    reason: answered ? e.message : '',
    viaKind: '',
    summary: '',
  };
}

// onRan —— 跑完之后通知卡片去重取一次状态（F-C-45）。这些操作会改变连接状态：撤权之后
// 跑一次探针，后端当场把那一行标成断开，而卡上的 `connected` 还是进页面时取的那一份。
// **不分成败都通知** —— 「哪类失败才要通知」得让每个操作各记一遍，下一个就会忘。
export function useConnectorOp(op: OwnerOp, onRan: () => void): ConnectorOpHook {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<OpOutcome | null>(null);
  const values = useRef<Record<string, string | number>>({});
  const segment = op.name.startsWith(OP_PREFIX) ? op.name.slice(OP_PREFIX.length) : op.name;

  const run = useCallback(() => {
    setRunning(true);
    setOutcome(null);
    void adminAPI.post(`/connectors/ops/${segment}`, { ...values.current }, OpResultSchema)
      .then((r) => setOutcome({
        reached: true, ok: r.ok ?? false, reason: r.reason ?? '',
        viaKind: r.via_kind ?? '', summary: r.summary ?? '',
      }))
      .catch((e: unknown) => setOutcome(failedOutcome(e)))
      .finally(() => { setRunning(false); onRan(); });
  }, [segment, onRan]);

  return {
    segment, running, outcome,
    setField: (key, value, type) => { setValue(values.current, key, value, type); },
    run,
  };
}

// setValue —— 空值就把这一格删掉,而不是送一个空串:op 的 schema 里 days 是 integer,
// 送 "" 过去它连解析都过不了,而 owner 的意思只是「这格我没填」。
function setValue(
  bag: Record<string, string | number>, key: string, value: string, type: string,
): void {
  const v = coerce(value, type);
  if (v === undefined) {
    delete bag[key];
    return;
  }
  bag[key] = v;
}
