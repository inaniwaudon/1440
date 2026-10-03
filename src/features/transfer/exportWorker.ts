import { downloadZip } from "client-zip";
import { db } from "../../db/db";
import { generateEntries, type ZipEntry } from "./generateEntries";
import { generateVideoEntries } from "./generateVideoEntries";

export type ExportWorkerInMsg =
  | { type: "start"; filename: string; kind: "main" }
  | { type: "start"; filename: string; kind: "video"; videoPhotoIds: string[] };

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
  write: (
    buffer: ArrayBufferView | ArrayBuffer,
    options?: { at?: number },
  ) => number;
  truncate: (size: number) => void;
  flush: () => void;
  close: () => void;
};

ctx.onmessage = async (event: MessageEvent<ExportWorkerInMsg>) => {
  if (event.data.type !== "start") return;
  const msg = event.data;
  const { filename } = msg;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(filename, { create: true });
    const access = await (
      handle as unknown as {
        createSyncAccessHandle: () => Promise<SyncAccessHandle>;
      }
    ).createSyncAccessHandle();

    try {
      access.truncate(0);

      let stream: AsyncGenerator<ZipEntry>;
      if (msg.kind === "main") {
        const photoIds = (await db.photos
          .toCollection()
          .primaryKeys()) as string[];
        if (photoIds.length === 0)
          throw new Error("書き出すデータがありません");
        const slots = await db.slots.orderBy("minuteOfDay").toArray();
        stream = generateEntries(photoIds, slots, (p) => {
          post({ type: "progress", current: p.current, total: p.total });
        });
      } else {
        stream = generateVideoEntries(msg.videoPhotoIds, (p) => {
          post({ type: "progress", current: p.current, total: p.total });
        });
      }

      const response = downloadZip(stream);
      if (!response.body)
        throw new Error("ZIP ストリームを作成できませんでした");
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
    post({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
