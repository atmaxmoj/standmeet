// bytes.ts —— 把字节数写成人读得懂的大小。
//
// 住在中立的 lib/format 而不是 lib/admin 或 lib/visitor:面板上的素材行和访客页面的
// 下载区说的是**同一件事**(这份文件多大)。各写一份的话,两边迟早在某个边界上不一致 ——
// 而"1023 B 在一处显示 1023 B、在另一处显示 1.0 KB"这种差别没人会去报告。

/** formatBytes —— 1023 B / 4.8 KB / 3.4 MB。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
