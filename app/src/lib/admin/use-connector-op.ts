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

// OP_PREFIX —— 声明的操作 id 统一以此开头,去掉就是路由段。跟后端 declaredOpPrefix
// (routes/admin/connectors.go)是同一条约定 —— 路由 `/connectors/ops/<段>` 本来就是公开的。
const OP_PREFIX = 'connectors.';

// OpResultSchema —— 每个操作回什么由它自己定,但共同的形状就这三样:成没成 / 没成的话一句
// 人话 / 成了的话是哪一路送出去的。别的字段这一层不认,也不该出现在面上。
const OpResultSchema = z.object({
  ok: z.boolean().nullish(),
  reason: z.string().nullish(),
  via_kind: z.string().nullish(),
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
}

export interface ConnectorOpHook {
  segment: string;
  running: boolean;
  outcome: OpOutcome | null;
  setField: (key: string, value: string) => void;
  run: () => void;
}

export function useConnectorOp(op: OwnerOp): ConnectorOpHook {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<OpOutcome | null>(null);
  const values = useRef<Record<string, string>>({});
  const segment = op.name.startsWith(OP_PREFIX) ? op.name.slice(OP_PREFIX.length) : op.name;

  const run = useCallback(() => {
    setRunning(true);
    setOutcome(null);
    void adminAPI.post(`/connectors/ops/${segment}`, { ...values.current }, OpResultSchema)
      .then((r) => setOutcome({
        reached: true, ok: r.ok ?? false, reason: r.reason ?? '', viaKind: r.via_kind ?? '',
      }))
      .catch(() => setOutcome({ reached: false, ok: false, reason: '', viaKind: '' }))
      .finally(() => setRunning(false));
  }, [segment]);

  return {
    segment, running, outcome,
    setField: (key, value) => { values.current[key] = value; },
    run,
  };
}
