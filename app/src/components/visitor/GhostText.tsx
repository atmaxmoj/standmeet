// GhostText —— ghost 的呈现:一层**会换行**的覆盖文字,压在输入框下面。
//
// 以前 ghost 是当作 `placeholder` 属性渲的。placeholder 不换行 —— 一行,到元素宽度就裁,没有
// 省略号 —— 而 ghost 是模型生成的任意长度散文,于是每一条长一点的都在半句话处断掉(F-A-25)。
// 容器从来不是瓶颈:同一条串按 Tab 收进同一个框当 value,textarea 自己就撑高、换行、完整可读。
//
// 所以这里只做一件事:把那条串放进一个真的元素里,让它按正常文本换行。排版必须跟输入框逐项对齐
// (字号 / 行高 / 字重 / 字体),否则光标会落在跟 ghost 不同的基线上。
//
// aria-hidden:它是「你可以这么问」的提示,不是页面内容;读屏用户拿到的是输入框自己的可及名。

import { useTranslations } from 'next-intl';

// text 收 null(没有 ghost 可渲)而不是让 caller 自己判 —— 那个判断挪回 caller 就是
// ComposerForm 多一个分支,而它已经顶着 complexity 3 的上限。
export function GhostText({ text }: { text: string | null }) {
  return text === null ? null : (
    <>
      {/* 提示是 ghost 的**兄弟**，不是它的一部分：`chat-ghost-text` 那个元素带的必须
          还是那条完整的 ghost 串，一个字不多（`visitor-ghost-readable` 逐字断言它）。
          第一版把提示塞进这个元素里，那条断言当场红 —— 而按 owner 定的边界，
          设计改动不该动到任何现有断言。 */}
      <div
        aria-hidden
        data-testid="chat-ghost-text"
        className="pointer-events-none whitespace-pre-wrap break-words text-(--color-faint) font-serif text-[22px] leading-[1.4] font-[380]"
      >
        {text}
      </div>
      <AcceptHint />
    </>
  );
}

// AcceptHint —— 「这句可以按 Tab 收进来」。
//
// Tab 一直是能接受的（`dispatchGhostKey` 吃掉 Tab 调 onAccept），但**界面上没有任何东西
// 说得出来**：ghost 是输入框里一段浅色衬线文字，跟 `ask…` 那个占位符长得一模一样，
// 于是访客没有理由认为它可以被接受，也不知道无视它会不会丢东西（UX-34）。
//
// **它自己占一行，不再压在句尾**：第一版把它绝对定位到右下角，指望 ghost 的最后一行
// 到不了那里。真环境上一驱就撞了 —— 模型出的 ghost 是任意长度的散文，两行那条的末尾
// 正好穿过提示（`chat-ghost/shots/gx-11`，UX-83）。给它自己一行，重叠就不可能发生，
// 而不是赌文字有多长（[[computed-class-generates-nothing]] 的同一类教训：靠巧合成立的
// 排版，换一条数据就不成立）。
function AcceptHint() {
  const t = useTranslations('visitor.chatRoom');
  return (
    <div
      aria-hidden
      data-testid="chat-ghost-accept-hint"
      className="pointer-events-none mt-0.5 text-right mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)"
    >
      {t('ghostAccept')}
    </div>
  );
}
