// heroField —— hero 那三格(封面图 / 压在图上那句话 / 色调)提交时该发什么。
//
// 后端这三列是**指针字段**:不发 = 不动,发空串 = 清掉。两处表单以前都写成「空串不发」,
// 于是三样**只进不出** —— owner 挑过一次色调之后，`— default —` 那个选项按下去、存下去、
// 重开还是原来那个色（prod 实测：violet → `— default —` → 仍是 violet）。界面看起来是他
// 挑的，而他没有任何撤销的办法（F-L-38(a)）。
//
// 分界不在「空不空」，在「跟载入时比，变了没有」：
//   - 载入是空、现在也空 → 这一格他从没碰过（新建表单永远走这条）→ **不发**，
//     否则会把「没设过」写成「明确清空」，两者在后端不是同一件事；
//   - 现在有值 → 发这个值；
//   - 载入有值、现在空了 → **发空串**，那正是「撤掉」。
export function heroField(current: string, loaded: string): string | undefined {
  return current === '' && loaded === '' ? undefined : current;
}
