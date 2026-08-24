// chunk.ts —— 把一段回答切成平台收得下的几条。
//
// **为什么必须切**：Telegram 单条上限 4096 字符，Discord 2000。而 owner 的语料答起来
// 动辄两三千字（这一轮在自定义页上实测过 2847）。不切的结果不是「显示不全」——
// 是平台直接拒收，读者**什么都收不到**，而日志里只有一条 400。
//
// 替身在这件事上一个字都不会说：它多长都收。所以这一层的判据只能自己立。

/** DEFAULT_LIMIT —— 两个平台里更紧的那个（Discord 2000），留一点余量。 */
export const DEFAULT_LIMIT = 1900;

/**
 * chunkForChat —— 按**语义边界**切，而不是按字数硬切。
 *
 * 顺序是有讲究的：先空行（段落），再换行，再句号，最后才硬切。
 * 硬切会把一个词、甚至一个 markdown 记号劈成两半 —— `**bold` 落在上一条、
 * `**` 落在下一条，读者看到的是两条都坏掉的消息。
 */
export function chunkForChat(text: string, limit = DEFAULT_LIMIT): string[] {
  const body = text.trim();
  if (body === '') return [];
  if (body.length <= limit) return [body];

  const out: string[] = [];
  let rest = body;
  while (rest.length > limit) {
    const cut = breakPoint(rest, limit);
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== '') out.push(rest);
  return out;
}

/**
 * breakPoint —— 在 limit 之内找最靠后的一个体面断点。
 *
 * 一个都找不到（比如一整段没有标点的长文本）才硬切在 limit 上 ——
 * 那时切坏一个词，也好过整条发不出去。
 */
function breakPoint(s: string, limit: number): number {
  const window = s.slice(0, limit);
  for (const sep of ['\n\n', '\n', '。', '. ', '！', '？', '! ', '? ']) {
    const at = window.lastIndexOf(sep);
    // 太靠前的断点不要：切出一条只有几十个字的消息，比切在句中还难看。
    if (at > limit * 0.5) return at + sep.length;
  }
  return limit;
}
