type LogEntry = { time: string; message: string };

const entries: LogEntry[] = [];
const listeners = new Set<(entries: LogEntry[]) => void>();
const MAX_ENTRIES = 200;

export function debugLog(...args: unknown[]): void {
  const message = args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(
    now.getMilliseconds(),
  ).padStart(3, "0")}`;
  entries.push({ time, message });
  if (entries.length > MAX_ENTRIES) entries.shift();
  for (const l of listeners) l([...entries]);
  // Also log to console for desktop debugging.
  console.log("[debug]", ...args);
}

export function subscribeDebugLog(
  listener: (entries: LogEntry[]) => void,
): () => void {
  listeners.add(listener);
  listener([...entries]);
  return () => listeners.delete(listener);
}

export function clearDebugLog(): void {
  entries.length = 0;
  for (const l of listeners) l([]);
}
