// SelectField —— 全 app 唯一的下拉。
//
// 为什么是组件而不是一个类名(UX-47):
// 在这之前 19 个 `<select>` 有**五种**互不知道的写法 —— 盒子边框、小盒子、下划线、
// sm-field-input、gate 那个近黑实心。加一个 `.sm-select` 类不解决问题:类名要靠人记得贴,
// 而**下一个写下拉的人不会知道它存在** —— 这正是前面五种写法的来历。
// 组件把「贴不贴」这件事从选择变成了默认,再由闸门(check-one-select.sh)禁掉裸 `<select>`。
//
// 另一个非要组件不可的理由是**技术性**的:朱红箭头得挂在伪元素上,而 `<select>` 挂不住
// `::after`。必须有一层 shell。既然一定要多包一层,那这层就该由组件负责,而不是要求
// 每个调用点自己记得包。
//
// className 落在 **shell** 上,因为 shell 才是布局盒(w-full / shrink-0 / min-w-0 都是给它的);
// 下拉自身的观感由组件决定,调用点只在 `mono` 一个开关上有话语权 —— 五种收成两种,
// 这个收敛就是修复本身。

'use client';

import type { ReactNode, SelectHTMLAttributes } from 'react';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  /** 落在 shell(布局盒)上的类:宽度、flex 行为。 */
  className?: string;
  /** 等宽体。表格行、能力 id 这类"机器读的值"用它;人写的标题用默认衬线。 */
  mono?: boolean;
  /**
   * 收 `testid` 而不是让调用点直接写 `data-testid` —— lint 禁止把 data-testid 贴在组件上,
   * 理由是**它可能哪儿都没落**。这里由组件保证它落到真正的 `<select>` 上,规则的意图成立,
   * 同时那条规则对其它组件仍然照常生效(见 [[move-the-capability-move-its-edges]]:
   * 能力搬家时,它的边 —— 测试钩子、lint 豁免 —— 不会自己跟着走)。
   */
  testid?: string;
  children: ReactNode;
};

function selectClass(mono: boolean): string {
  return mono ? 'sm-field-input sm-select sm-mono' : 'sm-field-input sm-select';
}

export function SelectField({ className = '', mono = false, testid, children, ...rest }: Props) {
  return (
    <span className={`sm-select-shell ${className}`}>
      <select className={selectClass(mono)} data-testid={testid} {...rest}>
        {children}
      </select>
    </span>
  );
}
