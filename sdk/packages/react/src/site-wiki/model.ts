// model.ts —— SiteWiki's data, from the store's documents (docs/design/site-wiki.md). Pure: no
// React, no network.
//
// A page version is one document { path, title, body } (or { path, removed: true }). The store
// only appends, so an edit is a new version and the newest per path is the page.

import type { StoredDoc } from '@standmeet/sdk-core';

export interface WikiVersion {
  id: string;
  path: string;
  title: string;
  body: string;
  removed: boolean;
  author: string;
  at: string;
}

// WikiPage —— a live page: its newest version, plus every version newest first.
export interface WikiPage extends WikiVersion {
  versions: WikiVersion[];
}

export type WikiPages = Map<string, WikiPage>;

// WikiFolder —— one level of the tree: the pages at this level and the folders under it.
export interface WikiFolder {
  name: string;
  pages: WikiPage[];
  folders: WikiFolder[];
}

const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// cleanPath —— a path as typed, without surrounding space or slashes.
export function cleanPath(p: string): string {
  return p.trim().replace(/^\/+|\/+$/g, '');
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function versionOf(d: StoredDoc): WikiVersion | null {
  const path = cleanPath(text(d['path']));
  if (path === '') return null;
  return {
    id: d._id, path, title: text(d['title']) || path, body: text(d['body']),
    removed: d['removed'] === true, author: d._author?.name ?? '', at: d._created_at ?? '',
  };
}

// pagesOf —— the live pages: the newest version per path, unless that version removed the page.
// The store gives documents oldest first, so a later document is a newer version.
export function pagesOf(docs: StoredDoc[]): WikiPages {
  const byPath = new Map<string, WikiVersion[]>();
  for (const d of docs) {
    const v = versionOf(d);
    if (v !== null) byPath.set(v.path, [v, ...(byPath.get(v.path) ?? [])]);
  }
  const pages: WikiPages = new Map();
  for (const [path, versions] of byPath) {
    const newest = versions[0];
    if (newest !== undefined && !newest.removed) pages.set(path, { ...newest, versions });
  }
  return pages;
}

// resolve —— the path a [[target]] means: the page with that path, else (ignoring case) that path
// or that title; null when no page matches.
export function resolve(target: string, pages: WikiPages): string | null {
  const want = cleanPath(target);
  if (pages.has(want)) return want;
  const lower = want.toLowerCase();
  for (const p of pages.values()) {
    if (p.path.toLowerCase() === lower || p.title.toLowerCase() === lower) return p.path;
  }
  return null;
}

// hrefOf —— the address of a page inside the microsite (the URL hash).
export function hrefOf(path: string): string {
  return `#/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// pathOfHref —— the page path an in-wiki href points at; null for any other link.
export function pathOfHref(href: string): string | null {
  if (!href.startsWith('#/')) return null;
  try {
    return cleanPath(decodeURIComponent(href.slice(2)));
  } catch {
    return null;
  }
}

// toMarkdown —— the body with each [[target|label]] as a markdown link to the target's address;
// a target with no page links to the path as written, where the page can be created.
export function toMarkdown(body: string, pages: WikiPages): string {
  return body.replace(LINK, (_m, target: string, label?: string) => {
    const path = resolve(target, pages) ?? cleanPath(target);
    const shown = (label ?? target).trim().replace(/[[\]]/g, '');
    return `[${shown}](${hrefOf(path)})`;
  });
}

// linksOf —— the paths a body links to (resolved where a page exists).
export function linksOf(body: string, pages: WikiPages): string[] {
  return [...body.matchAll(LINK)].map((m) => resolve(m[1] ?? '', pages) ?? cleanPath(m[1] ?? ''));
}

// backlinksOf —— the pages whose newest version links to this path.
export function backlinksOf(path: string, pages: WikiPages): WikiPage[] {
  return [...pages.values()].filter((p) => p.path !== path && linksOf(p.body, pages).includes(path));
}

// treeOf —— the pages grouped by their path's folders, each level sorted by title.
export function treeOf(pages: WikiPages): WikiFolder {
  const root: WikiFolder = { name: '', pages: [], folders: [] };
  for (const p of pages.values()) folderFor(root, p.path.split('/').slice(0, -1)).pages.push(p);
  sortFolder(root);
  return root;
}

function folderFor(root: WikiFolder, names: string[]): WikiFolder {
  let at = root;
  for (const name of names) {
    let next = at.folders.find((f) => f.name === name);
    if (next === undefined) {
      next = { name, pages: [], folders: [] };
      at.folders.push(next);
    }
    at = next;
  }
  return at;
}

function sortFolder(f: WikiFolder): void {
  f.pages.sort((a, b) => a.title.localeCompare(b.title));
  f.folders.sort((a, b) => a.name.localeCompare(b.name));
  f.folders.forEach(sortFolder);
}
