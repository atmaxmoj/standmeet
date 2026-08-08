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

// text 收 null(没有 ghost 可渲)而不是让 caller 自己判 —— 那个判断挪回 caller 就是
// ComposerForm 多一个分支,而它已经顶着 complexity 3 的上限。
export function GhostText({ text }: { text: string | null }) {
  return text === null ? null : (
    <div
      aria-hidden
      data-testid="chat-ghost-text"
      className="pointer-events-none whitespace-pre-wrap break-words text-(--color-faint) font-serif text-[22px] leading-[1.4] font-[380]"
    >
      {text}
    </div>
  );
}
