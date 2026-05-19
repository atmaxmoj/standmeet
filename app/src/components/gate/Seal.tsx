// Seal —— gate 页面顶部的"封口"圆环：三层圆，里面 mono 写
// "standmeet · <handle> / private"。视觉上立刻告诉访客这页是 gated。

type Props = { handle: string };

export function Seal({ handle }: Props) {
  return (
    <div className="relative shrink-0">
      <div className="seal">
        <div className="seal-text">
          <span>
            standmeet · {handle}<br />
            <span style={{ letterSpacing: '0.32em' }}>private</span>
          </span>
        </div>
      </div>
    </div>
  );
}
