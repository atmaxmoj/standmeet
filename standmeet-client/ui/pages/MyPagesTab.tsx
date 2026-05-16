import { useState, useEffect, useRef } from "react";
import type { PageListState } from "./PagesPage";
import { PageSidebar } from "./PagesPage";
import ResizeHandle from "../components/ResizeHandle";
import { useResizable } from "../hooks/useResizable";
import { usePageActions, PageCenterArea, PageRightPanel } from "./PageEditorPane";
import type { PageEditorState } from "./PageEditorPane";

interface PageFormState {
  name: string;
  description: string;
  roleId: string | null;
  metaTitle: string;
  metaDescription: string;
}

export default function MyPagesTab({ state }: { state: PageListState }) {
  const { mode, setMode, loadPages, mustUse, dontUse, onMustUseChange, onDontUseChange, onSelectionChange, roles, gatewayUrl, ownerToken, webUrl } = state;
  const explorer = useResizable({ defaultWidth: 260, minWidth: 160, maxWidth: 480, storageKey: "page-sidebar-width" });
  const rightPanel = useResizable({ defaultWidth: 320, minWidth: 220, maxWidth: 500, reverse: true, storageKey: "page-right-panel-width" });
  const [error, setError] = useState("");
  const [centerTab, setCenterTab] = useState<"preview" | "code">("preview");
  const [form, setForm] = useState<PageFormState>({
    name: "", description: "", roleId: null,
    metaTitle: "", metaDescription: "",
  });

  // Track previous mode to detect selection changes
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;

    if (mode.type === "view" && (prev.type !== "view" || (prev.type === "view" && prev.page.id !== mode.page.id))) {
      const page = mode.page;
      setForm({
        name: page.name, description: page.description,
        roleId: page.role_id,
        metaTitle: page.meta?.title || "", metaDescription: page.meta?.description || "",
      });
      setCenterTab("preview");
      setError("");
    } else if (mode.type === "new" && prev.type !== "new") {
      setForm({ name: "", description: "", roleId: null, metaTitle: "", metaDescription: "" });
      setCenterTab("preview");
      setError("");
    }
  }, [mode]);

  const editorState: PageEditorState = {
    mode, setMode, setError, form, setForm,
    roles, loadPages, mustUse, dontUse,
    onMustUseChange, onDontUseChange,
    onSelectionChange,
    gatewayUrl, ownerToken, webUrl,
    centerTab, setCenterTab,
  };

  const actions = usePageActions(editorState);

  return (
    <div className="page content-page" style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <PageSidebar
        pages={state.pages} mode={state.mode} loading={state.loading}
        width={explorer.width} onSelect={state.handleSelect} onNew={state.handleNew}
      />
      <ResizeHandle onMouseDown={explorer.onMouseDown} />

      {mode.type === "idle" ? (
        <div className="content-editor-pane">
          {error && <div className="alert error">{error}</div>}
          <div className="editor-empty"><p>Select a page to edit or click + to create one</p></div>
        </div>
      ) : (
        <>
          <PageCenterArea state={editorState} actions={actions} error={error} />
          <ResizeHandle onMouseDown={rightPanel.onMouseDown} />
          <div className="page-right-panel" style={{ width: rightPanel.width }}>
            <PageRightPanel state={editorState} actions={actions} />
          </div>
        </>
      )}
    </div>
  );
}
