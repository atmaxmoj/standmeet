// logger —— 前端唯一的 console 出口。
//
// eslint 设了 'no-console: error'，业务代码不让直接 console.*。这个文件本
// 身用 eslint-disable 突破，让所有 client-side 日志统一从这里走。
//
// 行为：
//   - dev (NODE_ENV !== 'production') 直接打 console.{info,warn,error}
//   - prod 默认 no-op；但独立开关 NEXT_PUBLIC_CLIENT_LOG=1 可强开(e2e prod app
//     诊断 / 线上排障都用它,不用靠改 NODE_ENV)。
//   - 后续可以加 navigator.sendBeacon → /internal/client-errors
//
// 用法：
//   import { logger } from '@/lib/logger';
//   logger.error('handle update', err);
//
// `unknown` 入参直接 spread 进 console；caller 别担心类型。

/* eslint-disable no-console */

interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

// NEXT_PUBLIC_CLIENT_LOG 是 build 期 inline 的独立开关:dev 默认开,prod 要显式
// 置 1 才开。跟 NODE_ENV 解耦 —— prod 也能临时开客户端日志排障。
function isDev(): boolean {
  if (process.env.NEXT_PUBLIC_CLIENT_LOG === '1') return true;
  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
}

export const logger: Logger = {
  info: (msg, ...args) => { isDev() && console.info(`[standmeet] ${msg}`, ...args); },
  warn: (msg, ...args) => { isDev() && console.warn(`[standmeet] ${msg}`, ...args); },
  error: (msg, ...args) => { isDev() && console.error(`[standmeet] ${msg}`, ...args); },
};
