import { downloadZip } from "client-zip";
import { db } from "../../db/db";
import type { ExportWorkerInMsg, ExportWorkerOutMsg } from "./exportWorker";
import { generateEntries } from "./generateEntries";

export type ExportProgress = { current: number; total: number };

export type ExportDestination =
  | { kind: "file"; blob: Blob; name: string; shareFile?: File }
  | { kind: "saved" };

export function suggestedArchiveName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `setlog-${yyyy}${mm}${dd}-${hh}${mi}.zip`;
}

async function cleanupOpfsExports(keep?: string): Promise<void> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return;
    const iterable = root as unknown as {
      entries: () => AsyncIterable<[string, unknown]>;
    };
    for await (const [name] of iterable.entries()) {
      if (typeof name !== "string") continue;
      if (name === keep) continue;
      if (name.startsWith("setlog-") && name.endsWith(".zip")) {
        await root.removeEntry(name).catch(() => {});
      }
      if (name === "pending-export.zip") {
        await root.removeEntry(name).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

export async function cleanupExportedArchive(): Promise<void> {
  await cleanupOpfsExports();
}

async function runExportInWorker(
  filename: string,
  onProgress: (p: ExportProgress) => void,
): Promise<void> {
  const worker = new Worker(new URL("./exportWorker.ts", import.meta.url), {
    type: "module",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ExportWorkerOutMsg>) => {
        const msg = event.data;
        if (msg.type === "progress") {
          onProgress({ current: msg.current, total: msg.total });
        } else if (msg.type === "done") {
          resolve();
        } else if (msg.type === "error") {
          reject(new Error(msg.error));
        }
      };
      worker.onerror = (err) => reject(err.error ?? new Error(err.message));
      const start: ExportWorkerInMsg = { type: "start", filename };
      worker.postMessage(start);
    });
  } finally {
    worker.terminate();
  }
}

export async function exportArchive(
  onProgress: (p: ExportProgress) => void,
): Promise<ExportDestination> {
  const name = suggestedArchiveName();

  // Desktop Chrome/Edge: let the user pick a destination and stream to disk.
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName?: string;
        types?: Array<{
          description: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (picker) {
    try {
      const photoIds = (await db.photos
        .toCollection()
        .primaryKeys()) as string[];
      if (photoIds.length === 0) throw new Error("書き出すデータがありません");
      const slots = await db.slots.orderBy("minuteOfDay").toArray();

      const handle = await picker({
        suggestedName: name,
        types: [
          {
            description: "setlog archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const response = downloadZip(
        generateEntries(photoIds, slots, onProgress),
      );
      if (!response.body)
        throw new Error("ZIP ストリームを作成できませんでした");
      const writable = await handle.createWritable();
      await response.body.pipeTo(writable);
      return { kind: "saved" };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Fall through if the picker is not usable in this context.
    }
  }

  // Preferred fallback (incl. iOS Safari PWA): ZIP generation + OPFS write in a
  // Worker using createSyncAccessHandle, which flushes straight to disk and
  // keeps peak memory bounded to a single ZIP chunk.
  const supportsWorkerOpfs =
    typeof Worker !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.storage?.getDirectory;

  if (supportsWorkerOpfs) {
    try {
      await cleanupOpfsExports(name);
      await runExportInWorker(name, onProgress);
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(name);
      const file = await handle.getFile();
      return { kind: "file", blob: file, name, shareFile: file };
    } catch (err) {
      console.warn(
        "[exportArchive] worker/OPFS path failed, falling back",
        err,
      );
      // fall through
    }
  }

  // Last resort: buffer the whole ZIP in memory. Fine for small datasets, may
  // crash iOS Safari for large exports — but by this point we've already lost.
  const photoIds = (await db.photos.toCollection().primaryKeys()) as string[];
  if (photoIds.length === 0) throw new Error("書き出すデータがありません");
  const slots = await db.slots.orderBy("minuteOfDay").toArray();
  const response = downloadZip(generateEntries(photoIds, slots, onProgress));
  const blob = await response.blob();
  return { kind: "file", blob, name };
}
