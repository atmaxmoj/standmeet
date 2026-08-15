// diagram-diagnostics.tsx —— 一张图编译不过的时候，说给谁听。
//
// 同一个 `MermaidBlock` 渲染在两种受众面前：**访客**（chat 的答复、公开的笔记）和 **owner**
// （admin 里回看逐字稿）。编译失败对这两个人意思完全不同：
//
//   - 访客：图只是补充，正文本来就必须自己站得住。所以那一格**什么都不出现** ——
//     绝不把 mermaid 库的原始解析错误糊到读者脸上（同 [[collapsed-error-class-kills-its-own-branch]]
//     那条规矩的另一面：产品的错误不该以第三方库的措辞出场）。
//   - owner：他要的正是那句报错 —— 模型画错了图，他得看得见。闸门不许把这个问题藏起来。
//
// 默认是**访客**那一档：一个新加的渲染入口忘了声明受众时，最坏结果是少显示一段诊断，
// 而不是把解析器的话漏给读者（fail-closed）。

'use client';

import { createContext, useContext } from 'react';

const DiagramDiagnosticsContext = createContext(false);

// DiagramDiagnostics —— 包住的那片渲染区里，编译失败要显示诊断（owner 面用）。
export function DiagramDiagnostics(
  { children }: { children: React.ReactNode },
): React.ReactElement {
  return (
    <DiagramDiagnosticsContext.Provider value>
      {children}
    </DiagramDiagnosticsContext.Provider>
  );
}

// useDiagramDiagnostics —— 这一格该不该把编译错误显出来。默认 false（访客）。
export function useDiagramDiagnostics(): boolean {
  return useContext(DiagramDiagnosticsContext);
}
