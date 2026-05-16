import { useState } from "react";

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  item?: ContentListItem;
}

export interface NamingState {
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onBlur: () => void;
  inputRef: React.Ref<HTMLInputElement>;
  placeholder: string;
}

interface FileTreeProps {
  items: ContentListItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateAt: (prefix: string) => void;
  naming?: NamingState | null;
}

function buildTree(items: ContentListItem[]): TreeNode[] {
  const root: TreeNode[] = [];

  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sorted) {
    const parts = item.path.replace(/^\//, "").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = "/" + parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === name);
      if (!node) {
        node = {
          name,
          path: fullPath,
          isFolder: !isLast,
          children: [],
          item: isLast ? item : undefined,
        };
        current.push(node);
      }

      if (!isLast) {
        node.isFolder = true;
        current = node.children;
      }
    }
  }

  return root;
}

function NamingInput({ naming, depth }: { naming: NamingState; depth: number }) {
  const displayLen = naming.value.length || naming.placeholder.length;
  return (
    <div className="tree-new-input" style={{ paddingLeft: `${12 + depth * 16}px` }}>
      <input
        ref={naming.inputRef}
        data-testid="content-new-input"
        value={naming.value}
        onChange={(e) => naming.onChange(e.target.value)}
        onKeyDown={naming.onKeyDown}
        onBlur={naming.onBlur}
        placeholder={naming.placeholder}
        spellCheck={false}
        style={{ width: `${displayLen + 2}ch` }}
      />
    </div>
  );
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  onCreateAt,
  expanded,
  onToggle,
  naming,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateAt: (prefix: string) => void;
  expanded: boolean;
  onToggle: () => void;
  naming?: NamingState | null;
}) {
  const isSelected = selectedPath === node.path;
  const isNamingTarget = naming != null && naming.prefix === node.path + "/";
  // Auto-expand if this node is an ancestor of the naming target
  const isNamingAncestor = naming != null && naming.prefix.startsWith(node.path + "/") && !isNamingTarget;
  const showExpanded = expanded || isNamingTarget || isNamingAncestor;

  return (
    <li>
      <div
        data-testid={`file-tree-item-${node.path.replace(/^\//, "").replace(/\//g, "-")}`}
        className={`tree-item ${isSelected ? "active" : ""} ${node.isFolder ? "folder" : "file"}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => {
          onSelect(node.path);
          if (node.isFolder && !expanded) onToggle();
        }}
      >
        <span
          className={`tree-chevron ${node.isFolder ? (showExpanded ? "open" : "") : "hidden"}`}
          onClick={(e) => {
            if (node.isFolder) {
              e.stopPropagation();
              onToggle();
            }
          }}
        >
          ❯
        </span>
        <span className="tree-name">{node.name}</span>
        {node.item?.visibility === "public" && (
          <span className="tree-badge public" title="Public">P</span>
        )}
        <button
          className="tree-action"
          title="New file here"
          onClick={(e) => {
            e.stopPropagation();
            onCreateAt(node.path + "/");
          }}
        >
          +
        </button>
      </div>
      {(node.isFolder || isNamingTarget) && showExpanded && (
        <>
          {isNamingTarget && <NamingInput naming={naming} depth={depth + 1} />}
          {node.children.length > 0 && (
            <TreeList
              nodes={node.children}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onCreateAt={onCreateAt}
              naming={naming}
            />
          )}
        </>
      )}
    </li>
  );
}

function TreeList({
  nodes,
  depth,
  selectedPath,
  onSelect,
  onCreateAt,
  naming,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateAt: (prefix: string) => void;
  naming?: NamingState | null;
}) {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.isFolder).map((n) => n.path)),
  );

  const toggle = (path: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <ul className="tree-list">
      {depth === 0 && naming?.prefix === "/" && (
        <li><NamingInput naming={naming} depth={depth} /></li>
      )}
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={depth}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onCreateAt={onCreateAt}
          expanded={expandedSet.has(node.path)}
          onToggle={() => toggle(node.path)}
          naming={naming}
        />
      ))}
    </ul>
  );
}

export default function FileTree({
  items,
  selectedPath,
  onSelect,
  onCreateAt,
  naming,
}: FileTreeProps) {
  const tree = buildTree(items);

  if (items.length === 0) {
    if (naming) {
      return (
        <ul className="tree-list">
          <li><NamingInput naming={naming} depth={0} /></li>
        </ul>
      );
    }
    return <p className="muted tree-empty">No content yet</p>;
  }

  return (
    <TreeList
      nodes={tree}
      depth={0}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onCreateAt={onCreateAt}
      naming={naming}
    />
  );
}
