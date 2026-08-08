// copy-tikz-fonts —— 把 node-tikzjax 自带的 TeX 字体搬进 public/,由本实例自己发。
//
// 为什么必须发:tikzjax 输出的 SVG 里,文字是 `<text>` + `font-family: cmr10 / cmsy10 / …`,
// 字符是 **TeX 字体的槽位**而不是 Unicode。`$\to$` 在 cmsy10 里落在 0x21 —— 也就是 `!`。
// 字体不加载,浏览器退回系统字体,箭头当场变成惊叹号,字距也按错的度量排,词会被拆开。
//
// 为什么自己发而不用它的默认值:`fontCssUrl` 默认指着 jsDelivr 的 CDN。这是个**自托管**
// 产品 —— 离线装的实例取不到,而且每张图都要替 owner 的读者向第三方发一次请求。
//
// 跟着 build 跑,所以字体永远跟 node_modules 里那个版本一致(手工 vendor 进仓库会悄悄过期)。

import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('node-tikzjax/package.json'));
const src = join(pkgDir, 'css');
const dest = join(import.meta.dirname, '..', 'public', 'tikz-fonts');

// fonts.css 用相对路径引 bakoma/ttf/*.ttf,所以整个 css/ 目录照搬,布局不能动。
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`[tikz-fonts] ${src} → ${dest}`);
