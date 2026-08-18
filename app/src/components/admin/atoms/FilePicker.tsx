// FilePicker —— 「选一个文件」的唯一写法。
//
// 浏览器原生的 `<input type="file">` 会自己画一个 `Choose File / No file chosen`：长相由
// 操作系统决定，跟这个产品的任何一处都对不上。UX-81 是在连接器弹窗里抓到的 —— 整扇窗里唯一
// 没被设计过的控件，就贴在被设计过的按钮旁边。修完那一处之后，同样的东西还站在另外两个地方
// （wiki 条目的 FILES 行、writing 的封面图）—— 一条教训只修了发现它的那一处。
//
// 所以这里不是第三次手修，而是把写法收成一个：藏起 input，让包着它的 `<label>` 当按钮。
// **点击行为一模一样** —— label 天然把点击转发给内部的 input，不需要 onClick，也不需要 ref。
//
// ⚠️ 藏起原生控件会一并藏掉它印的文件名。所以调用点必须自己有回执：spec 选完立刻解析出候选卡，
// 素材选完立刻进列表，封面选完立刻出预览。三处都有 —— 没有回执的地方不许用这个 atom。
//
// testid 落在真正的 input 上（不像 Btn 那样不暴露）：测试驱动文件选择靠 setInputFiles，
// 它要的就是那个 input 元素。

import type { RefObject } from 'react';

import { resolveBtnClass } from '@/lib/admin/btn-styles';

import type { BtnKind, BtnSize } from '@/components/admin/atoms/Btn';

type Props = {
  label: string;
  testid: string;
  onPick: (files: FileList | null) => void;
  accept?: string;
  disabled?: boolean;
  kind?: BtnKind;
  size?: BtnSize;
  inputRef?: RefObject<HTMLInputElement | null>;
};

// pickerClass —— 缺省成 ghost/sm：这是个次要动作（旁边通常还站着真正的主按钮）。
// 单拎出来是因为两个 `??` 加下面那个三元刚好越过 complexity 闸门。
function pickerClass(kind: BtnKind | undefined, size: BtnSize | undefined): string {
  return resolveBtnClass(kind ?? 'ghost', size ?? 'sm');
}

export function FilePicker(props: Props) {
  const dim = props.disabled ? 'opacity-50' : '';
  return (
    <label className={`${pickerClass(props.kind, props.size)} cursor-pointer ${dim}`}>
      {props.label}
      <input
        ref={props.inputRef}
        type="file"
        accept={props.accept}
        disabled={props.disabled}
        data-testid={props.testid}
        onChange={(e) => props.onPick(e.target.files)}
        className="sr-only"
      />
    </label>
  );
}
