import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { db } from "../../db/db";
import type { PhotoRecord, SlotRecord } from "../../db/types";
import {
  type ArchiveManifest,
  type ArchivePhotoMeta,
  ARCHIVE_VERSION,
} from "./archive";

export type ImportArchiveProgress = {
  current: number;
  total: number;
  phase: "scan" | "write";
};

export type ImportArchiveResult = {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
};

export type ImportMode = "replace" | "merge-keep" | "merge-overwrite";

export type ArchiveSummary = {
  manifest: ArchiveManifest;
  photos: ArchivePhotoMeta[];
  slots: SlotRecord[];
};

const METADATA_FILES = new Set(["manifest.json", "photos.json", "slots.json"]);

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function readArchiveMetadata(file: File): Promise<ArchiveSummary> {
  const summary: Partial<ArchiveSummary> = {};
  let done = false;

  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (entry: UnzipFile) => {
      if (!METADATA_FILES.has(entry.name)) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      entry.ondata = (err, chunk, final) => {
        if (err) {
          reject(err);
          return;
        }
        if (chunk) {
          chunks.push(chunk);
          size += chunk.length;
        }
        if (final) {
          try {
            const text = new TextDecoder().decode(concat(chunks, size));
            const parsed = JSON.parse(text);
            if (entry.name === "manifest.json") summary.manifest = parsed;
            if (entry.name === "photos.json") summary.photos = parsed;
            if (entry.name === "slots.json") summary.slots = parsed;
            if (summary.manifest && summary.photos && summary.slots) {
              done = true;
              resolve();
            }
          } catch (parseErr) {
            reject(parseErr);
          }
        }
      };
      entry.start();
    };

    (async () => {
      const reader = file.stream().getReader();
      try {
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) {
            unzip.push(new Uint8Array(0), true);
            if (!done) reject(new Error("アーカイブに必要なメタデータが含まれていません"));
            return;
          }
          unzip.push(value, false);
        }
      } catch (err) {
        reject(err);
      } finally {
        reader.cancel().catch(() => {});
      }
    })();
  });

  if (!summary.manifest || !summary.photos || !summary.slots) {
    throw new Error("アーカイブに必要なメタデータが含まれていません");
  }
  if (summary.manifest.version > ARCHIVE_VERSION) {
    throw new Error(
      `このアプリは アーカイブバージョン ${summary.manifest.version} に対応していません`,
    );
  }
  return summary as ArchiveSummary;
}

type PendingPhoto = {
  meta: ArchivePhotoMeta;
  thumbnail?: Blob;
  preview?: Blob;
  video?: Blob;
  // Parts that must still arrive before the record can be flushed to the DB.
  pending: Set<"thumbnail" | "preview" | "video">;
};

export async function importArchive(
  file: File,
  summary: ArchiveSummary,
  mode: ImportMode,
  onProgress: (p: ImportArchiveProgress) => void,
): Promise<ImportArchiveResult> {
  const result: ImportArchiveResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const metaByPath = new Map<string, ArchivePhotoMeta>();
  const videoPrefix = new Map<string, ArchivePhotoMeta>();
  for (const meta of summary.photos) {
    metaByPath.set(meta.thumbnail, meta);
    if (meta.preview) metaByPath.set(meta.preview, meta);
    // Video extension is only known from the archive; map by id prefix.
    videoPrefix.set(`photos/${meta.id}/video.`, meta);
  }

  const pending = new Map<string, PendingPhoto>();
  const existingSlots = new Map<number, string>();
  for (const slot of await db.slots.toArray()) {
    existingSlots.set(slot.minuteOfDay, slot.photoId);
  }
  const slotsByPhotoId = new Map<string, SlotRecord>();
  for (const slot of summary.slots) {
    slotsByPhotoId.set(slot.photoId, slot);
  }

  if (mode === "replace") {
    await db.transaction("rw", db.photos, db.slots, async () => {
      await db.photos.clear();
      await db.slots.clear();
    });
    existingSlots.clear();
  }

  const total = summary.photos.length;
  onProgress({ current: 0, total, phase: "write" });

  const shouldSkip = (meta: ArchivePhotoMeta): boolean => {
    const slot = slotsByPhotoId.get(meta.id);
    if (!slot) return false;
    if (mode === "merge-keep" && existingSlots.has(slot.minuteOfDay)) {
      return true;
    }
    return false;
  };

  const expectedParts = (meta: ArchivePhotoMeta): PendingPhoto["pending"] => {
    const set = new Set<"thumbnail" | "preview" | "video">(["thumbnail"]);
    if (meta.preview) set.add("preview");
    if (meta.video) set.add("video");
    return set;
  };

  const flushPhoto = async (ph: PendingPhoto) => {
    const slot = slotsByPhotoId.get(ph.meta.id);
    if (!slot) {
      result.skipped++;
      return;
    }
    if (!ph.thumbnail) {
      result.failed++;
      result.errors.push({ id: ph.meta.id, error: "サムネイルが欠けています" });
      return;
    }
    const record: PhotoRecord = {
      id: ph.meta.id,
      capturedAt: ph.meta.capturedAt,
      minuteOfDay: ph.meta.minuteOfDay,
      thumbnailBlob: ph.thumbnail,
      previewBlob: ph.preview,
      videoBlob: ph.video,
      originalFileName: ph.meta.originalFileName,
      mimeType: ph.meta.mimeType,
      originalWidth: ph.meta.originalWidth,
      originalHeight: ph.meta.originalHeight,
      importedAt: ph.meta.importedAt,
      capturedAtSource: ph.meta.capturedAtSource,
    };
    try {
      await db.transaction("rw", db.photos, db.slots, async () => {
        await db.photos
          .where("minuteOfDay")
          .equals(slot.minuteOfDay)
          .delete();
        await db.photos.put(record);
        await db.slots.put({
          minuteOfDay: slot.minuteOfDay,
          photoId: ph.meta.id,
        });
      });
      existingSlots.set(slot.minuteOfDay, ph.meta.id);
      result.imported++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        id: ph.meta.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Serialize DB writes so IndexedDB transactions don't contend; `queue` chains
  // writes while the ZIP stream keeps flowing.
  let queue: Promise<void> = Promise.resolve();
  const enqueueWrite = (ph: PendingPhoto) => {
    queue = queue.then(() => flushPhoto(ph)).then(() => {
      onProgress({
        current: result.imported + result.skipped + result.failed,
        total,
        phase: "write",
      });
    });
  };

  const resolveMetaForEntry = (name: string): {
    meta: ArchivePhotoMeta;
    kind: "thumbnail" | "preview" | "video";
  } | null => {
    const direct = metaByPath.get(name);
    if (direct) {
      if (name === direct.thumbnail) return { meta: direct, kind: "thumbnail" };
      if (name === direct.preview) return { meta: direct, kind: "preview" };
    }
    for (const [prefix, meta] of videoPrefix) {
      if (name.startsWith(prefix)) return { meta, kind: "video" };
    }
    return null;
  };

  const handleEntry = (entry: UnzipFile) => {
    if (METADATA_FILES.has(entry.name)) return;
    const resolved = resolveMetaForEntry(entry.name);
    if (!resolved) return;
    if (shouldSkip(resolved.meta)) {
      // Mark as skipped once; subsequent parts of the same photo are ignored.
      if (!pending.has(resolved.meta.id)) {
        pending.set(resolved.meta.id, {
          meta: resolved.meta,
          pending: new Set(),
        });
        result.skipped++;
        onProgress({
          current: result.imported + result.skipped + result.failed,
          total,
          phase: "write",
        });
      }
      return;
    }

    let ph = pending.get(resolved.meta.id);
    if (!ph) {
      ph = {
        meta: resolved.meta,
        pending: expectedParts(resolved.meta),
      };
      pending.set(resolved.meta.id, ph);
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (err, chunk, final) => {
      if (err) {
        result.failed++;
        result.errors.push({ id: resolved.meta.id, error: err.message });
        return;
      }
      if (chunk && chunk.length > 0) {
        // fflate reuses its internal buffer, so copy before holding onto it.
        chunks.push(new Uint8Array(chunk));
        size += chunk.length;
      }
      if (final) {
        const bytes = concat(chunks, size);
        const type = resolved.kind === "video"
          ? resolved.meta.mimeType ?? "video/*"
          : resolved.meta.mimeType ?? "image/webp";
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type });
        if (resolved.kind === "thumbnail") ph!.thumbnail = blob;
        else if (resolved.kind === "preview") ph!.preview = blob;
        else ph!.video = blob;
        ph!.pending.delete(resolved.kind);
        if (ph!.pending.size === 0) {
          pending.delete(resolved.meta.id);
          enqueueWrite(ph!);
        }
      }
    };
    entry.start();
  };

  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = handleEntry;

    (async () => {
      const reader = file.stream().getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            unzip.push(new Uint8Array(0), true);
            resolve();
            return;
          }
          unzip.push(value, false);
          // Yield to the event loop so the UI stays responsive during large archives.
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (err) {
        reject(err);
      } finally {
        reader.cancel().catch(() => {});
      }
    })();
  });

  // Flush any photos that were buffered but never completed (shouldn't happen for well-formed archives).
  for (const ph of pending.values()) {
    if (ph.pending.size > 0) {
      result.failed++;
      result.errors.push({
        id: ph.meta.id,
        error: "アーカイブ内のファイルが不足しています",
      });
    }
  }
  pending.clear();

  await queue;

  onProgress({
    current: result.imported + result.skipped + result.failed,
    total,
    phase: "write",
  });

  return result;
}
