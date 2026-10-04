import { useEffect, useState } from "react";
import { clearDebugLog, subscribeDebugLog } from "../../utils/debugLog";

type Entry = { time: string; message: string };

export function DebugOverlay() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [copyLabel, setCopyLabel] = useState("copy");

  useEffect(() => subscribeDebugLog(setEntries), []);

  const handleCopy = async () => {
    const text = entries.map((e) => `${e.time} ${e.message}`).join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyLabel("copied!");
      setTimeout(() => setCopyLabel("copy"), 1500);
    } catch {
      setCopyLabel("failed");
      setTimeout(() => setCopyLabel("copy"), 1500);
    }
  };

  if (entries.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        bottom: 8,
        zIndex: 99999,
        maxWidth: "min(560px, calc(100vw - 16px))",
        maxHeight: collapsed ? 32 : "40vh",
        overflow: "auto",
        background: "rgba(0,0,0,0.78)",
        color: "#0f0",
        font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "6px 8px",
        borderRadius: 6,
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: collapsed ? 0 : 4,
          position: "sticky",
          top: 0,
          background: "rgba(0,0,0,0.78)",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: "transparent",
            color: "#9f9",
            border: "1px solid #363",
            borderRadius: 3,
            padding: "1px 6px",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          {collapsed ? `▸ debug（${entries.length}）` : "▾ debug"}
        </button>
        {!collapsed && (
          <>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                background: "transparent",
                color: "#9cf",
                border: "1px solid #336",
                borderRadius: 3,
                padding: "1px 6px",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {copyLabel}
            </button>
            <button
              type="button"
              onClick={clearDebugLog}
              style={{
                background: "transparent",
                color: "#f99",
                border: "1px solid #633",
                borderRadius: 3,
                padding: "1px 6px",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              clear
            </button>
          </>
        )}
      </div>
      {!collapsed && (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            userSelect: "text",
            WebkitUserSelect: "text",
            font: "inherit",
            color: "inherit",
          }}
        >
          {entries.map((e) => `${e.time} ${e.message}`).join("\n")}
        </pre>
      )}
    </div>
  );
}
