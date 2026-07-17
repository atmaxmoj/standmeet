// i18n/request —— next-intl 的服务端入口：这一次请求用哪个 locale、加载哪份消息。
//
// **故意不接 locale 路由**（没有 `app/[locale]/`）。现在只有一种语言，路由分段是给"选语言"用的，
// 而选语言还不存在 —— 提前引入它就是让每一条 URL 现在就为一个尚不存在的功能付代价。
// next-intl 官方支持这种 without-routing 形态：locale 从这里给。将来真要多语言，改的是这个文件
// （读 cookie / Accept-Language / URL 分段），**组件一行都不用动** —— 这正是先做 infra 的意义。
//
// 基准语言 = en：产品的 UI 本来就是英文的，之前混进来的几处中文 help 文案是异类，已一并归位。
//
// **命名空间 = 文件**，扁平，一个 section 一个（admin 本来就是按 section 组织的，命名空间照它的
// 真实结构走，不另发明一套）。扁平的代价是这里的 import 列表长；收益是加一块只要两行、没有深合并
// 逻辑、而且几个人同时改不同区域时不会撞在同一个巨大的 JSON 上。

import { getRequestConfig } from 'next-intl/server';

import adminAccess from '@/i18n/messages/en/admin-access.json';
import adminCorpus from '@/i18n/messages/en/admin-corpus.json';
import adminIntegrations from '@/i18n/messages/en/admin-integrations.json';
import adminJobs from '@/i18n/messages/en/admin-jobs.json';
import adminPages from '@/i18n/messages/en/admin-pages.json';
import adminShell from '@/i18n/messages/en/admin-shell.json';
import auth from '@/i18n/messages/en/auth.json';
import gate from '@/i18n/messages/en/gate.json';
import page from '@/i18n/messages/en/page.json';
import reader from '@/i18n/messages/en/reader.json';
import visitor from '@/i18n/messages/en/visitor.json';
import writings from '@/i18n/messages/en/writings.json';

// DEFAULT_LOCALE —— 唯一的 locale。加第二种语言时，这里变成一次协商，而不是一次重写。
export const DEFAULT_LOCALE = 'en';

// messages —— 每个顶层键就是一个 useTranslations(...) 的命名空间。
export const messages = {
  adminShell,
  adminCorpus,
  adminAccess,
  adminIntegrations,
  adminJobs,
  adminPages,
  auth,
  gate,
  page,
  reader,
  visitor,
  writings,
};

export default getRequestConfig(() => ({
  locale: DEFAULT_LOCALE,
  messages,
}));
