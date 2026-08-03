// use-outbound.ts —— owner 有没有一条**送得出去**的出站通道。
//
// 面板上只有两处问这件事：批准 gate 请求（要把码送给申请人）和账号找回（要把 phrase 送给
// owner）。两处问的都是同一个是非题，所以这里只回答这一个：`connected`。
//
// 这个文件以前叫 `use-mail.ts`，导出 saveCredentials / disconnect / otp{send,verify} 一整套。
// 那套里 **四条都打在死路由上**：`/connectors/mail/credentials` 和 `/disconnect` 用的是死 id
// `mail`（真 id 是 `smtp`，见下），`/connectors/mail/send-otp` 和 `/verify-otp` 后端**根本没有**
// 这两条路由。而且**没有任何组件调用它们** —— 两个消费者都只读 `.connected`。
// 一套指向死路由的死接口，随时会被下一个人接上去，所以删掉，不是留着。
//
// 同理删掉的还有 `MailCredsInput{host,port,username,password,from_address,from_name}` 和
// `MailStatusSchema` 里那几个从来没被填过的字段 —— 那是**一封信和一台 SMTP 服务器的形状**，
// 后端刚把它从内核类型里去掉，没有理由让它在前端原样活着。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// OutboundStatus —— 只有一个是非题：送不送得出去。
const OutboundStatusSchema = z.object({
  connected: z.boolean(),
  hasCredentials: z.boolean(),
});
export type OutboundStatus = z.infer<typeof OutboundStatusSchema>;

// 出站连接器的规范 id 是 `smtp`（品类 `mail`），**不是** `mail` —— 打 `/connectors/mail/status`
// 解的是一个死 id，永远回 connected:false，于是即使 owner 配好了能真发信的连接器，
// 批准闸和找回闸也一直锁着（F-C-7）。所以从**权威的连接器列表**里推：
// 品类为出站、已连接且是 active 的那一个。
const OutboundRowSchema = z.object({
  category: z.string(),
  has_credentials: z.boolean().nullish(),
  connected: z.boolean(),
  active: z.boolean().nullish(),
});
const ConnectorsListSchema = z.object({
  connectors: z.array(OutboundRowSchema).nullish(),
});

// outboundCategory —— 送通知走哪个品类。**只有这一个字符串**，因为列表是按品类分的；
// 它不代表这一层知道 SMTP 或者一封信长什么样。
const outboundCategory = 'mail';

const outboundStatusStore = createResourceStore<OutboundStatus>({
  name: 'outbound-status',
  fetcher: async () => {
    const list = await adminAPI.get('/connectors', ConnectorsListSchema);
    const rows = (list.connectors ?? []).filter((c) => c.category === outboundCategory);
    const live = rows.find((c) => c.connected && (c.active ?? true));
    return OutboundStatusSchema.parse({
      connected: Boolean(live),
      hasCredentials: rows.some((c) => c.has_credentials ?? false),
    });
  },
});

export interface OutboundHook {
  statusKind: ResourceStatus;
  status: OutboundStatus | null;
}

/** useOutbound —— owner 有没有一条送得出去的出站通道。 */
export function useOutbound(): OutboundHook {
  const r = useResource(outboundStatusStore);
  const ensureLoaded = r.ensureLoaded;
  // 不拉就永远是 null,而 null 会被读成"送不出去" —— 批准闸和找回闸就一直锁着。
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { statusKind: r.status, status: r.data ?? null };
}
