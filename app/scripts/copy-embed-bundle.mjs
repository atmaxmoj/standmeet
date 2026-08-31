// copy-embed-bundle —— 把 @standmeet/embed 的 IIFE 产物搬进 public/，由本实例自己发。
//
// **为什么必须发**：CLAUDE.md 承诺 embed 是"单个 `<script>` 标签 drop-in"，而线上
// `/embed.js` 和 `/sdk/embed.js` 都是 404（2026-08-30 实测）—— 包构建得出来，
// 承诺写在文档里，中间那一段不存在。文档里写着一个地址，而没有任何东西验证它指向
// 存在的东西（[[ref-resolves-not-a-string]]）。
//
// **为什么是 IIFE 那一份**：drop-in 的场景是别人的站点写一行 `<script src>`，
// 没有打包器、没有 import map。ESM 那份要 `type="module"` 且不能给老站点用。
//
// **为什么自己发而不是挂 CDN**：这是个自托管产品。挂 CDN 等于每个 owner 的读者
// 都要替他向第三方发一次请求，而离线装的实例根本取不到 —— 跟 tikz-fonts 同一条理由。
//
// 跟着 build 跑，所以发出去的永远跟仓库里的 sdk 源码同一个版本。

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');
const src = join(APP_DIR, '..', 'sdk', 'packages', 'embed', 'dist', 'embed.global.js');
const dest = join(APP_DIR, 'public', 'embed.js');

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);

console.log(`[embed] ${src} → ${dest}`);
