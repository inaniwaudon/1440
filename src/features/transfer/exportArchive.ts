import { downloadZip } from "client-zip";
import { db } from "../../db/db";
import type { ExportWorkerInMsg, ExportWorkerOutMsg } from "./exportWorker";
import { generateEntries } from "./generateEntries";
import { generateVideoEntries } from "./generateVideoEntries";

export type ExportProgress = {
  step: number;
  totalSteps: number;
  label: string;
  current: number;
  total: number;
};

export type ExportedFile = {
  blob: Blob;
  name: string;
  shareFile?: File;
  kind: "main" | "video";
};

export type ExportDestination =
  | { kind: "files"; files: ExportedFile[] }
  | { kind: "saved" };

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

export function suggestedArchiveName(): string {
  return `1440-${timestamp()}.zip`;
}

// Keep every archive reasonably easy to save/share on mobile. The uncompressed
// Blob sizes provide a conservative estimate of the resulting ZIP size.
export const ARCHIVE_SIZE_LIMIT = 250 * 1024 * 1024;

function chunkArchiveName(
  stamp: string,
  part: number,
  totalParts: number,
): string {
  if (totalParts === 1) return `1440-${stamp}.zip`;
  const padded = String(part).padStart(2, "0");
  return `1440-${stamp}-${padded}.zip`;
}

function videoArchiveName(
  stamp: string,
  part: number,
  totalParts: number,
): string {
  if (totalParts === 1) return `1440-${stamp}-video.zip`;
  const width = Math.max(2, String(totalParts).length);
  return `1440-${stamp}-video-${String(part).padStart(width, "0")}.zip`;
}

async function cleanupOpfsExports(keep?: Set<string>): Promise<void> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return;
    const iterable = root as unknown as {
      entries: () => AsyncIterable<[string, unknown]>;
    };
    for await (const [name] of iterable.entries()) {
      if (typeof name !== "string") continue;
      if (keep?.has(name)) continue;
      if (name.startsWith("1440-") && name.endsWith(".zip")) {
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
  msg: ExportWorkerInMsg,
  onProgress: (current: number, total: number) => void,
): Promise<void> {
  const worker = new Worker(new URL("./exportWorker.ts", import.meta.url), {
    type: "module",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ExportWorkerOutMsg>) => {
        const data = event.data;
        if (data.type === "progress") {
          onProgress(data.current, data.total);
        } else if (data.type === "done") {
          resolve();
        } else if (data.type === "error") {
          reject(new Error(data.error));
        }
      };
      worker.onerror = (err) => reject(err.error ?? new Error(err.message));
      worker.postMessage(msg);
    });
  } finally {
    worker.terminate();
  }
}

async function readOpfsFile(filename: string): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(filename);
  return await handle.getFile();
}

async function chunkPhotoIdsBySize(
  photoIds: string[],
  kind: "main" | "video",
): Promise<string[][]> {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;

  for (const id of photoIds) {
    const photo = await db.photos.get(id);
    if (!photo || (kind === "video" && !photo.videoBlob)) continue;
    const size =
      photo.thumbnailBlob.size +
      (photo.previewBlob?.size ?? 0) +
      (kind === "video" ? (photo.videoBlob?.size ?? 0) : 0);
    if (current.length > 0 && currentSize + size > ARCHIVE_SIZE_LIMIT) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(id);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function exportArchive(
  onProgress: (p: ExportProgress) => void,
): Promise<ExportDestination> {
  const stamp = timestamp();

  const allPhotoIds = (await db.photos
    .toCollection()
    .primaryKeys()) as string[];
  if (allPhotoIds.length === 0) throw new Error("書き出すデータがありません");
  const allSlots = await db.slots.orderBy("minuteOfDay").toArray();
  const slotByPhotoId = new Map(allSlots.map((s) => [s.photoId, s]));

  const chunks = await chunkPhotoIdsBySize(allPhotoIds, "main");
  const videoChunks = await chunkPhotoIdsBySize(allPhotoIds, "video");
  const totalSteps = chunks.length + videoChunks.length;
  const chunkNames = chunks.map((_, i) =>
    chunkArchiveName(stamp, i + 1, chunks.length),
  );
  const videoChunkNames = videoChunks.map((_, i) =>
    videoArchiveName(stamp, i + 1, videoChunks.length),
  );
  const allArchiveNames = [...chunkNames, ...videoChunkNames];
  const chunkSlots = chunks.map((ids) =>
    ids
      .map((id) => slotByPhotoId.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s),
  );

  // Desktop with File System Access API: pick each destination and stream.
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
      for (let i = 0; i < chunks.length; i++) {
        const handle = await picker({
          suggestedName: chunkNames[i],
          types: [
            {
              description: "1440 archive",
              accept: { "application/zip": [".zip"] },
            },
          ],
        });
        const response = downloadZip(
          generateEntries(chunks[i], chunkSlots[i], (p) =>
            onProgress({
              step: i + 1,
              totalSteps,
              label: `データ（${i + 1}/${chunks.length}）`,
              current: p.current,
              total: p.total,
            }),
          ),
        );
        if (!response.body)
          throw new Error("ZIP ストリームを作成できませんでした");
        const writable = await handle.createWritable();
        await response.body.pipeTo(writable);
      }
      for (let i = 0; i < videoChunks.length; i++) {
        const handle = await picker({
          suggestedName: videoChunkNames[i],
          types: [
            {
              description: "1440 video archive",
              accept: { "application/zip": [".zip"] },
            },
          ],
        });
        const response = downloadZip(
          generateVideoEntries(videoChunks[i], (p) =>
            onProgress({
              step: chunks.length + i + 1,
              totalSteps,
              label: `動画（${i + 1}/${videoChunks.length}）`,
              current: p.current,
              total: p.total,
            }),
          ),
        );
        if (!response.body)
          throw new Error("ZIP ストリームを作成できませんでした");
        const writable = await handle.createWritable();
        await response.body.pipeTo(writable);
      }
      return { kind: "saved" };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
    }
  }

  const supportsWorkerOpfs =
    typeof Worker !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.storage?.getDirectory;

  if (supportsWorkerOpfs) {
    try {
      await cleanupOpfsExports(new Set(allArchiveNames));

      const files: ExportedFile[] = [];
      for (let i = 0; i < chunks.length; i++) {
        try {
          await runExportInWorker(
            {
              type: "start",
              filename: chunkNames[i],
              kind: "main",
              photoIds: chunks[i],
              slots: chunkSlots[i],
            },
            (current, total) =>
              onProgress({
                step: i + 1,
                totalSteps,
                label: `データ（${i + 1}/${chunks.length}）`,
                current,
                total,
              }),
          );
        } catch (err) {
          throw new Error(
            `チャンク ${i + 1}/${totalSteps} の生成に失敗: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        try {
          const file = await readOpfsFile(chunkNames[i]);
          files.push({
            blob: file,
            name: chunkNames[i],
            shareFile: file,
            kind: "main",
          });
        } catch (err) {
          throw new Error(
            `チャンク ${i + 1}/${totalSteps} の読み込みに失敗: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        // Give the browser a tick to settle before spinning up the next
        // Worker; iOS Safari sometimes needs an event-loop turn to flush OPFS.
        await new Promise((r) => setTimeout(r, 50));
      }
      for (let i = 0; i < videoChunks.length; i++) {
        try {
          await runExportInWorker(
            {
              type: "start",
              filename: videoChunkNames[i],
              kind: "video",
              videoPhotoIds: videoChunks[i],
            },
            (current, total) =>
              onProgress({
                step: chunks.length + i + 1,
                totalSteps,
                label: `動画（${i + 1}/${videoChunks.length}）`,
                current,
                total,
              }),
          );
          const file = await readOpfsFile(videoChunkNames[i]);
          files.push({
            blob: file,
            name: videoChunkNames[i],
            shareFile: file,
            kind: "video",
          });
        } catch (err) {
          throw new Error(
            `動画 ${i + 1}/${videoChunks.length} の生成に失敗: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return { kind: "files", files };
    } catch (err) {
      console.warn(
        "[exportArchive] worker/OPFS path failed, falling back",
        err,
      );
      throw new Error(
        `[fallback] Worker/OPFS failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const files: ExportedFile[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const response = downloadZip(
      generateEntries(chunks[i], chunkSlots[i], (p) =>
        onProgress({
          step: i + 1,
          totalSteps,
          label: `データ（${i + 1}/${chunks.length}）`,
          current: p.current,
          total: p.total,
        }),
      ),
    );
    const blob = await response.blob();
    const shareFile = new File([blob], chunkNames[i], {
      type: "application/zip",
    });
    files.push({
      blob,
      name: chunkNames[i],
      shareFile,
      kind: "main",
    });
    await new Promise((r) => setTimeout(r, 50));
  }
  for (let i = 0; i < videoChunks.length; i++) {
    const response = downloadZip(
      generateVideoEntries(videoChunks[i], (p) =>
        onProgress({
          step: chunks.length + i + 1,
          totalSteps,
          label: `動画（${i + 1}/${videoChunks.length}）`,
          current: p.current,
          total: p.total,
        }),
      ),
    );
    const blob = await response.blob();
    const shareFile = new File([blob], videoChunkNames[i], {
      type: "application/zip",
    });
    files.push({
      blob,
      name: videoChunkNames[i],
      shareFile,
      kind: "video",
    });
    await new Promise((r) => setTimeout(r, 50));
  }
  return { kind: "files", files };
}
