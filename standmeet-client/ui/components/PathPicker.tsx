import { useState, useEffect, useRef } from "react";

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
}

interface PathPickerProps {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const sorted = [...paths].sort();

  for (const itemPath of sorted) {
    const parts = itemPath.replace(/^\//, "").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = "/" + parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === name);
      if (!node) {
        node = { name, path: fullPath, isFolder: !isLast, children: [] };
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

function TreeItem({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const handleClick = () => {
    if (node.isFolder) {
      onSelect(node.path + "/*");
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <li>
      <div
        className="path-picker-item"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleClick}
      >
        {node.isFolder && (
          <span className={`tree-chevron ${expanded ? "open" : ""}`}>❯</span>
        )}
        {!node.isFolder && <span className="tree-chevron hidden">❯</span>}
        <span className="tree-name">{node.name}</span>
        {node.isFolder && <span className="path-picker-hint">/*</span>}
      </div>
      {node.isFolder && expanded && node.children.length > 0 && (
        <ul className="path-picker-list">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function PathPicker({ value, onChange, testId }: PathPickerProps) {
  const [open, setOpen] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.standmeet.content.list().then((items: ContentListItem[]) => {
      setPaths(items.map((i) => i.path));
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const tree = buildTree(paths);

  const handleSelect = (path: string) => {
    onChange(path);
    setOpen(false);
  };

  return (
    <div className="path-picker" ref={ref}>
      <input
        type="text"
        data-testid={testId}
        value={value}
        readOnly
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        placeholder="Select a path..."
        className="path-picker-input"
      />
      {open && paths.length > 0 && (
        <div className="path-picker-dropdown">
          <ul className="path-picker-list">
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                onSelect={handleSelect}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
