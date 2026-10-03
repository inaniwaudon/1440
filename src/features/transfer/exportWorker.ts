import { downloadZip } from "client-zip";
import { generateEntries } from "./generateEntries";
import { db } from "../../db/db";

export type ExportWorkerInMsg = { type: "start"; filename: string };
export type ExportWorkerOutMsg =
  | { type: "progress"; current: number; total: number }
  | { type: "done"; filename: string }
  | { type: "error"; error: string };

type WorkerCtx = {
  postMessage: (msg: ExportWorkerOutMsg) => void;
  onmessage: ((event: MessageEvent<ExportWorkerInMsg>) => void) | null;
};

const ctx = self as unknown as WorkerCtx;

function post(msg: ExportWorkerOutMsg) {
  ctx.postMessage(msg);
}

type SyncAccessHandle = {
  write: (buffer: ArrayBufferView | ArrayBuffer, options?: { at?: number }) => number;
  truncate: (size: number) => void;
  flush: () => void;
  close: () => void;
};

ctx.onmessage = async (event: MessageEvent<ExportWorkerInMsg>) => {
  if (event.data.type !== "start") return;
  const { filename } = event.data;
  try {
    const photoIds = (await db.photos.toCollection().primaryKeys()) as string[];
    if (photoIds.length === 0) throw new Error("書き出すデータがありません");
    const slots = await db.slots.orderBy("minuteOfDay").toArray();

    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(filename, { create: true });
    const access = (await (
      handle as unknown as {
        createSyncAccessHandle: () => Promise<SyncAccessHandle>;
      }
    ).createSyncAccessHandle());

    try {
      access.truncate(0);
      const response = downloadZip(
        generateEntries(photoIds, slots, (p) => {
          post({ type: "progress", current: p.current, total: p.total });
        }),
      );

      if (!response.body) throw new Error("ZIP ストリームを作成できませんでした");
      const reader = response.body.getReader();
      let offset = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          access.write(value, { at: offset });
          offset += value.byteLength;
        }
      }
      access.flush();
    } finally {
      access.close();
    }

    post({ type: "done", filename });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
