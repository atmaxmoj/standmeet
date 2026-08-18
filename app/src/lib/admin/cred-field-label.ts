// credFieldLabel —— 凭据字段键印给人看的那一份。
//
// 键是 API 契约里的名字（`from_address`），标签是给人读的（`FROM ADDRESS`）。全产品别处的
// 标签都是空格分词（`COVER LINE`、`BASE URL`、`TAGS (COMMA-SEPARATED)`），只有凭据这几格
// 带着下划线 —— 而它就摆在那张句子写得很完整的日历卡旁边（UX-58 说的「同一块面板两个标准」）。
//
// 为什么单独一个文件：**渲染凭据格的地方有两处**（连接器卡上的 `CredField`、装配表单里的
// `PlainField`），它们的职责不同（一个管 scopes/readonly，一个只管键值），合并会丢东西
// （[[duplicate-carries-a-unique-job]]）。但「键怎么变成标签」这件事只该有一个答案，
// 否则下一次改动只会跟到其中一半（[[lesson-not-swept-to-neighbours]]）。
//
// 只改渲染：testid、发出去的键、后端契约都还是原来的键。
export function credFieldLabel(key: string): string {
  return key.replaceAll('_', ' ');
}
