// cssVars —— 把自定义属性（`--x`）交给 `style`。
//
// 为什么需要这个帮手：
// 传自定义属性这件事在四个地方各写一遍，就会各自决定怎么写（而它们上一次各自决定的结果
// 是四份拼出来的类名，全都一条 CSS 都不生成）。收进一个有名字的函数，写法只剩一种，
// 键的类型也把「这里只放自定义属性」写进了签名。
//
// **为什么不用 Tailwind 的任意属性**（`[--max-w:540px]`）：
// 那个写法只在值是**字面量**时成立。一旦写成 `[--max-w:${'${w}'}px]`，Tailwind 在构建期
// 扫到的是一个不合法的串，**一条 CSS 都不生成** —— 而类名照样进了 HTML，变量退回兜底值，
// 没有任何工具会报错。这份代码里曾有四处这样的写法，后果分别是：模态永远满宽、两根进度条
// 永远是 0%、编辑器气泡工具条永远贴在左上角。闸门 check-no-computed-class.sh 现在禁掉它。
//
// 所以运行时算出来的值只有一条路：`style`。这也正是 no-restricted-syntax 那条规则
// 留口子的原因（"Truly runtime-dynamic values: single-line eslint-disable with a why"）。

import type { CSSProperties } from 'react';

// 入参类型把键限定成 `--*`：这个函数只负责自定义属性，别的样式该走类名。
// （不需要类型断言 —— 键全是 `--*` 的对象本来就赋得过去，写断言反而被 lint 判为多余。）
export function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars;
}
