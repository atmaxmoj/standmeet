// CorpusScopePicker —— 从**真的 corpus 树**上勾出一组 URI，而不是让 owner 默写它们（F-A-14）。
//
// role 的授权和 code 的收回是同一种语言（一组 glob），所以是同一个 picker：调用方只管拿 value /
// onChange。
//
// 三条设计，每条都有由来：
//
// 1. **勾的是树上真实存在的行**，URI 取自后端给的 `path`（服务端 slug）。owner 再也不用知道
//    `subjectivity://cv` 长什么样 —— 他只是勾了「cv」那一行。
// 2. **勾一个有子节点的行 = 两条 glob**（`g://p` + `g://p/**`）。glob 方言里 `g://p/**` 不匹配
//    `g://p` 自己；只发子树那条，owner 会以为授了整棵，实际漏了那个 folder-note 本身。这个坑归
//    组件管，不去动匹配器。
// 3. **看不懂的 glob 原样留着**，不吃掉。owner 可能手写过 `wiki://**/draft` —— 树上没有哪一行
//    对应它。一个把值往复翻译一遍的 picker 会在保存时**静默删掉**它。所以：树只负责它认得的那些，
//    其余原封不动带走，并且在下面如实列出来。

'use client';

import { useCallback, useState } from 'react';

import { useAdminTreeLayer } from '@/lib/admin/use-admin-tree-layer';
import {
  SCOPE_GENRES, foreignGlobs, genreGlob, globsFor, loadScopeLayer, uriOf,
  type ScopeGenre, type ScopeNode,
} from '@/lib/admin/use-corpus-scope-tree';

interface PickerProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  testid: string;
}

export function CorpusScopePicker({ value, onChange, testid }: PickerProps) {
  const selected = new Set(value);
  const toggle = useCallback((globs: string[], on: boolean) => {
    const next = new Set(value);
    globs.forEach((g) => (on ? next.add(g) : next.delete(g)));
    onChange([...next]);
  }, [value, onChange]);
  // 树认不出来的（手写的怪 glob、拼错的、将来新增 genre 的）——原样留着，不静默丢。
  const foreign = foreignGlobs(value);
  return (
    <div className="flex flex-col gap-2" data-testid={testid}>
      {SCOPE_GENRES.map((genre) => (
        <GenreBlock key={genre} genre={genre} selected={selected} toggle={toggle} prefix={testid} />
      ))}
      <ForeignGlobs globs={foreign} prefix={testid} />
    </div>
  );
}

// ForeignGlobs —— 树表达不了的那些。列出来（而不是藏起来）：owner 得看得见自己这份授权里还有什么。
function ForeignGlobs({ globs, prefix }: { globs: readonly string[]; prefix: string }) {
  return globs.length === 0 ? null : (
    <div
      className="mono text-[10px] text-(--color-muted) mt-1"
      data-testid={`${prefix}-foreign-globs`}
    >
      <span className="text-(--color-faint)">kept as written (not on the tree): </span>
      {globs.join('  ')}
    </div>
  );
}

interface BlockProps {
  genre: ScopeGenre;
  selected: Set<string>;
  toggle: (globs: string[], on: boolean) => void;
  // prefix —— 这个 picker 实例的 testid 命名空间。一页上每张 role 卡各有一个 picker，
  // 不带前缀的 `scope-genre-wiki` 会同时命中好几个（第一版就是这样）。
  prefix: string;
}

// GenreBlock —— 一个 genre：整棵的勾 + 可展开的树。
function GenreBlock({ genre, selected, toggle, prefix }: BlockProps) {
  const [open, setOpen] = useState(false);
  const whole = genreGlob(genre);
  return (
    <div className="border-l border-(--color-rule) pl-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mono text-[10px] text-(--color-faint) w-3"
          aria-expanded={open}
          data-testid={`${prefix}-toggle-${genre}`}
        >
          {open ? '▾' : '▸'}
        </button>
        <label className="mono text-[11px] flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(whole)}
            onChange={(e) => toggle([whole], e.target.checked)}
            data-testid={`${prefix}-genre-${genre}`}
          />
          <span className="text-(--color-ink)">{genre}</span>
          <span className="text-(--color-faint)">— all of it ({whole})</span>
        </label>
      </div>
      {open ? (
        <ScopeLevel genre={genre} parentID="" selected={selected} toggle={toggle} prefix={prefix} />
      ) : null}
    </div>
  );
}

interface LevelProps extends BlockProps {
  parentID: string;
}

// ScopeLevel —— 懒加载一层（复用 admin 树那套：一次一层，大 corpus 不会整棵拉下来）。
function ScopeLevel({ genre, parentID, selected, toggle, prefix }: LevelProps) {
  const load = useCallback((p: string) => loadScopeLayer(genre, p), [genre]);
  const nodes = useAdminTreeLayer(load, parentID, true, 0);
  return nodes === null ? (
    <p className="mono text-[10px] text-(--color-faint) pl-5">loading…</p>
  ) : (
    <ul className="pl-5">
      {nodes.map((n) => (
        <ScopeRow key={n.id} genre={genre} node={n} selected={selected} toggle={toggle}
          prefix={prefix} />
      ))}
    </ul>
  );
}

// ScopeRow —— 一行。勾它 = 它自己（有子节点时再加它的整棵子树，见文件头第 2 条）。
function ScopeRow({ genre, node, selected, toggle, prefix }: BlockProps & { node: ScopeNode }) {
  const [open, setOpen] = useState(false);
  const globs = globsFor(genre, node);
  const hasKids = node.has_children === true;
  return (
    <li>
      <div className="flex items-center gap-2">
        <Expander open={open} hasKids={hasKids} onToggle={() => setOpen((o) => !o)}
          id={`${prefix}-${node.id}`} />
        <label className="mono text-[11px] flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(uriOf(genre, node))}
            onChange={(e) => toggle(globs, e.target.checked)}
            data-testid={`${prefix}-node-${uriOf(genre, node)}`}
          />
          <span className="text-(--color-ink)">{node.title}</span>
          {hasKids ? <span className="text-(--color-faint)">+ everything under it</span> : null}
        </label>
      </div>
      {open ? (
        <ScopeLevel genre={genre} parentID={node.id} selected={selected} toggle={toggle}
          prefix={prefix} />
      ) : null}
    </li>
  );
}

function Expander(
  { open, hasKids, onToggle, id }:
  { open: boolean; hasKids: boolean; onToggle: () => void; id: string },
) {
  return hasKids ? (
    <button
      type="button" onClick={onToggle} aria-expanded={open}
      className="mono text-[10px] text-(--color-faint) w-3"
      data-testid={`${id}-expand`}
    >
      {open ? '▾' : '▸'}
    </button>
  ) : <span className="w-3" aria-hidden="true" />;
}
