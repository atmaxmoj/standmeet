interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  direction?: "horizontal" | "vertical";
}

export default function ResizeHandle({ onMouseDown, direction = "horizontal" }: ResizeHandleProps) {
  return (
    <div
      className={`resize-handle ${direction === "vertical" ? "resize-handle-vertical" : ""}`}
      onMouseDown={onMouseDown}
    />
  );
}
