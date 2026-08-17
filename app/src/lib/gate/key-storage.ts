// key-storage.ts —— **这个浏览器现在能不能替访客保管一把 key**（F-D-14）。
//
// BYOAI 的整条路都压在 `crypto.subtle` 上（`byoai-vault.ts` 用它封 key、`byoai-envelope.ts`
// 用它封信封）。而 `crypto.subtle` **只在 secure context 存在** —— https，或者 localhost。
// 一个自托管实例只要还没上 TLS，**任何一个从别的机器打开它的人**（也就是每一个真访客、
// 以及 owner 自己）拿到的都是没有 `crypto.subtle` 的页面。
//
// 以前这件事只在**按下按钮之后**才暴露：异常冒到 `use-gate.ts` 的通用兜底，屏幕上说
// 「Couldn't check that just now. Try again.」—— 而重试一万次都一样。所以判断挪到**进门前**。
//
// 断的是**能力本身**（`crypto.subtle` 在不在），不是 `isSecureContext` 这个旗子：要用的是
// 前者，那就问前者。两者在浏览器里等价，而万一哪天不等价，报错的仍然是真正会失败的那个。

/**
 * keyStorageAvailable —— 这个 realm 里能不能做 Web Crypto 的封装。
 * SSR（没有 window）返回 true：服务端渲染的那一帧按「正常部署」走，客户端挂载后再纠正，
 * 免得每个 https 访客先闪一下警告。真实结论永远由浏览器给出。
 */
export function keyStorageAvailable(): boolean {
  if (typeof window === 'undefined') return true;
  return typeof window.crypto !== 'undefined' && window.crypto.subtle !== undefined;
}
