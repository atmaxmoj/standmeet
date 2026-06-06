// prompts-fs.ts —— PromptSource adapter: fs.readFile {root}/{id}.md
//
// 跟 prod browser 的 HTTP GET /api/v1/prompts/{id} 同语义 —— fragment id
// 还原成文件路径，读出来当 system prompt 片段。eval-harness 默认指
// backend/internal/prompts (跟 prod 同一份)，scenario 不另存 prompt 文本，
// 改 prompt 就改 prod 路径，下一次 eval 自动跟。

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import type { PromptSource } from '@standmeet/agent-core';

export interface FsPromptSourceOptions {
  readonly root: string;
}

export function fsPromptSource(opts: FsPromptSourceOptions): PromptSource {
  const root = resolve(opts.root);
  return {
    async load(id: string): Promise<string> {
      const safe = sanitizeID(id);
      const path = join(root, `${safe}.md`);
      try {
        return await readFile(path, 'utf-8');
      } catch (err) {
        throw new Error(`fsPromptSource: load(${id}) failed at ${path}: ${(err as Error).message}`);
      }
    },
  };
}

// sanitizeID —— fragment id 是相对路径 (e.g. "capabilities/corpus.retrieval")。
// 防止 "../../" 跳出 root。允许字母 / 数字 / `_` / `-` / `.` / `/`，其他全
// reject (eval 是本地工具但还是保持约束让 typo 不静默)。
function sanitizeID(id: string): string {
  if (!/^[a-zA-Z0-9_\-./]+$/.test(id) || id.includes('..')) {
    throw new Error(`fsPromptSource: id has invalid chars or path traversal: ${id}`);
  }
  return id;
}
