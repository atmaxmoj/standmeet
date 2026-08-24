// code.ts —— 从一条私信里认出访客带来的那张**访问码**。
//
// 这是桥的第一道门：没有码就没有会话，跟网页那条路上 `/gate` 的位置一样。
// 认得宽一点是有意的 —— 人在聊天窗口里不会照格式打字，他会发 `/start ROOM-001`、
// 发 `ROOM-001`、发 `我的码是 ROOM-001`，甚至连着一句话发过来。这三种都得认。
//
// **但不能宽到把普通句子认成码** —— 认错了的后果不是「码无效」那么轻：产品会拿着
// 一个不存在的码去开会话，然后告诉一个刚打招呼的人「没有这张码」，而他根本没提过码。

/** 码的形状：`LABEL-XXX`，大写字母/数字，中间一个连字符。跟 access_codes 那一侧一致。 */
const CODE = /\b([A-Z][A-Z0-9]{1,15}-[A-Z0-9]{2,16})\b/;

/**
 * findCode —— 消息里那张码，没有就是空串。
 *
 * 只在**大写**形状上匹配：聊天里的普通词几乎不会长成 `ABC-123`，而一旦放宽到
 * 小写，`hello-world` 这种就会被当成码。宁可漏认让人重发一次，也不要错认。
 */
export function findCode(text: string): string {
  const m = CODE.exec(stripCommand(text));
  return m ? m[1]! : '';
}

/**
 * stripCommand —— 去掉 `/start`、`/code` 这类命令前缀。
 *
 * Telegram 的 `/start <payload>` 是扫码进来的标准形状（二维码里就带着 payload），
 * Discord 那边人更可能直接打。两种都落到同一个字符串上再找码。
 */
function stripCommand(text: string): string {
  return text.replace(/^\s*\/(start|code|begin)(@\S+)?\s*/i, ' ');
}

/** looksLikeOnlyCode —— 整条消息基本就是一张码（用来判断要不要把它也当成一句提问）。 */
export function looksLikeOnlyCode(text: string): boolean {
  const code = findCode(text);
  if (code === '') return false;
  const rest = stripCommand(text).replace(code, '').trim();
  return rest.length <= 2;
}
