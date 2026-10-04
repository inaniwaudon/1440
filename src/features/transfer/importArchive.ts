import { Unzip, type UnzipFile, UnzipInflate } from "fflate";
import { db } from "../../db/db";
import type { PhotoRecord, SlotRecord } from "../../db/types";
import {
  ARCHIVE_VERSION,
  type ArchiveManifest,
  type ArchivePhotoMeta,
  type VideoArchiveEntry,
  type VideoArchiveManifest,
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

export type ArchiveSummary = {
  kind: "main";
  manifest: ArchiveManifest;
  photos: ArchivePhotoMeta[];
  slots: SlotRecord[];
};

export type VideoArchiveSummary = {
  kind: "video";
  manifest: VideoArchiveManifest;
};

export type AnyArchiveSummary = ArchiveSummary | VideoArchiveSummary;

const METADATA_FILES = new Set([
  "version.json",
  "manifest.json",
  "photos.json",
  "slots.json",
  "video-manifest.json",
]);
const REQUIRED_METADATA = ["manifest", "photos", "slots"] as const;

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function readArchiveMetadata(
  file: File,
): Promise<AnyArchiveSummary> {
  const mainSummary: Partial<ArchiveSummary> = {};
  let videoManifest: VideoArchiveManifest | undefined;
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
            if (entry.name === "manifest.json") mainSummary.manifest = parsed;
            else if (entry.name === "photos.json") mainSummary.photos = parsed;
            else if (entry.name === "slots.json") mainSummary.slots = parsed;
            else if (entry.name === "video-manifest.json")
              videoManifest = parsed;
            if (videoManifest) {
              done = true;
              resolve();
              return;
            }
            if (REQUIRED_METADATA.every((key) => mainSummary[key])) {
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
            if (!done)
              reject(
                new Error("アーカイブに必要なメタデータが含まれていません"),
              );
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

  if (videoManifest) {
    if (videoManifest.version > ARCHIVE_VERSION) {
      throw new Error(
        `このアプリケーションは アーカイブバージョン ${videoManifest.version} に対応していません`,
      );
    }
    return { kind: "video", manifest: videoManifest };
  }

  if (!mainSummary.manifest || !mainSummary.photos || !mainSummary.slots) {
    throw new Error("アーカイブに必要なメタデータが含まれていません");
  }
  if (mainSummary.manifest.version > ARCHIVE_VERSION) {
    throw new Error(
      `このアプリケーションは アーカイブバージョン ${mainSummary.manifest.version} に対応していません`,
    );
  }
  return {
    kind: "main",
    manifest: mainSummary.manifest,
    photos: mainSummary.photos,
    slots: mainSummary.slots,
  };
}

type PendingPhoto = {
  meta: ArchivePhotoMeta;
  thumbnail?: Blob;
  preview?: Blob;
  // Parts that must still arrive before the record can be flushed to the DB.
  pending: Set<"thumbnail" | "preview">;
};

export async function importArchive(
  file: File,
  summary: ArchiveSummary,
  onProgress: (p: ImportArchiveProgress) => void,
): Promise<ImportArchiveResult> {
  const result: ImportArchiveResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const metaByPath = new Map<string, ArchivePhotoMeta>();
  for (const meta of summary.photos) {
    metaByPath.set(meta.thumbnail, meta);
    if (meta.preview) metaByPath.set(meta.preview, meta);
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

  const total = summary.photos.length;
  onProgress({ current: 0, total, phase: "write" });

  const expectedParts = (meta: ArchivePhotoMeta): PendingPhoto["pending"] => {
    const set = new Set<"thumbnail" | "preview">(["thumbnail"]);
    if (meta.preview) set.add("preview");
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
    const thumbnail = ph.thumbnail;
    try {
      await db.transaction("rw", db.photos, db.slots, async () => {
        // Preserve any existing video on the same photo id so a later video
        // archive import can still attach, and so a re-import of only the
        // main archive doesn't discard the video.
        const existing = await db.photos.get(ph.meta.id);
        const record: PhotoRecord = {
          id: ph.meta.id,
          capturedAt: ph.meta.capturedAt,
          minuteOfDay: ph.meta.minuteOfDay,
          thumbnailBlob: thumbnail,
          previewBlob: ph.preview,
          videoBlob: existing?.videoBlob,
          originalFileName: ph.meta.originalFileName,
          mimeType: ph.meta.mimeType,
          originalWidth: ph.meta.originalWidth,
          originalHeight: ph.meta.originalHeight,
          importedAt: ph.meta.importedAt,
          capturedAtSource: ph.meta.capturedAtSource,
        };
        await db.photos.where("minuteOfDay").equals(slot.minuteOfDay).delete();
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
    queue = queue
      .then(() => flushPhoto(ph))
      .then(() => {
        onProgress({
          current: result.imported + result.skipped + result.failed,
          total,
          phase: "write",
        });
      });
  };

  const resolveMetaForEntry = (
    name: string,
  ): {
    meta: ArchivePhotoMeta;
    kind: "thumbnail" | "preview";
  } | null => {
    const direct = metaByPath.get(name);
    if (direct) {
      if (name === direct.thumbnail) return { meta: direct, kind: "thumbnail" };
      if (name === direct.preview) return { meta: direct, kind: "preview" };
    }
    return null;
  };

  const handleEntry = (entry: UnzipFile) => {
    if (METADATA_FILES.has(entry.name)) return;
    const resolved = resolveMetaForEntry(entry.name);
    if (!resolved) return;

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
        const type = resolved.meta.mimeType ?? "image/webp";
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type });
        if (!ph) return;
        if (resolved.kind === "thumbnail") ph.thumbnail = blob;
        else ph.preview = blob;
        ph.pending.delete(resolved.kind);
        if (ph.pending.size === 0) {
          pending.delete(resolved.meta.id);
          enqueueWrite(ph);
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

export async function importVideoArchive(
  file: File,
  summary: VideoArchiveSummary,
  onProgress: (p: ImportArchiveProgress) => void,
): Promise<ImportArchiveResult> {
  const result: ImportArchiveResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  type VideoPart = "thumbnail" | "preview" | "video";
  type PendingVideo = {
    entry: VideoArchiveEntry;
    thumbnail?: Blob;
    preview?: Blob;
    video?: Blob;
    pending: Set<VideoPart>;
  };
  const partByPath = new Map<
    string,
    { entry: VideoArchiveEntry; kind: VideoPart }
  >();
  const pending = new Map<string, PendingVideo>();
  for (const entry of summary.manifest.videos) {
    partByPath.set(entry.path, { entry, kind: "video" });
    if (entry.photo) {
      partByPath.set(entry.photo.thumbnail, { entry, kind: "thumbnail" });
      if (entry.photo.preview) {
        partByPath.set(entry.photo.preview, { entry, kind: "preview" });
      }
    }
    const expected = new Set<VideoPart>(["video"]);
    if (entry.photo) {
      expected.add("thumbnail");
      if (entry.photo.preview) expected.add("preview");
    }
    pending.set(entry.photoId, { entry, pending: expected });
  }
  const total = summary.manifest.videos.length;
  onProgress({ current: 0, total, phase: "write" });

  const writeVideo = async (item: PendingVideo): Promise<void> => {
    const { entry } = item;
    try {
      const existing = await db.photos.get(entry.photoId);
      if (!item.video) throw new Error("動画ファイルが欠けています");

      if (!entry.photo || !entry.slot || !item.thumbnail) {
        // Legacy video archives can only be attached to an already restored
        // main record because they did not carry standalone photo metadata.
        if (existing) {
          await db.photos.put({
            ...existing,
            videoBlob: item.video,
            mimeType: entry.mimeType ?? existing.mimeType,
          });
          result.imported++;
          return;
        }
        result.skipped++;
        return;
      }

      const meta = entry.photo;
      const slot = entry.slot;
      const record: PhotoRecord = {
        id: meta.id,
        capturedAt: meta.capturedAt,
        minuteOfDay: meta.minuteOfDay,
        thumbnailBlob: item.thumbnail,
        previewBlob: item.preview,
        videoBlob: item.video,
        originalFileName: meta.originalFileName,
        mimeType: entry.mimeType ?? meta.mimeType,
        originalWidth: meta.originalWidth,
        originalHeight: meta.originalHeight,
        importedAt: meta.importedAt,
        capturedAtSource: meta.capturedAtSource,
      };
      await db.transaction("rw", db.photos, db.slots, async () => {
        await db.photos.where("minuteOfDay").equals(slot.minuteOfDay).delete();
        await db.photos.put(record);
        await db.slots.put(slot);
      });
      result.imported++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        id: entry.photoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (item: PendingVideo) => {
    queue = queue
      .then(() => writeVideo(item))
      .then(() => {
        onProgress({
          current: result.imported + result.skipped + result.failed,
          total,
          phase: "write",
        });
      });
  };

  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (entry: UnzipFile) => {
      if (METADATA_FILES.has(entry.name)) return;
      const resolved = partByPath.get(entry.name);
      if (!resolved) return;

      const chunks: Uint8Array[] = [];
      let size = 0;
      entry.ondata = (err, chunk, final) => {
        if (err) {
          result.failed++;
          result.errors.push({
            id: resolved.entry.photoId,
            error: err.message,
          });
          return;
        }
        if (chunk && chunk.length > 0) {
          chunks.push(new Uint8Array(chunk));
          size += chunk.length;
        }
        if (final) {
          const bytes = concat(chunks, size);
          const item = pending.get(resolved.entry.photoId);
          if (!item) return;
          const blob = new Blob([bytes.buffer as ArrayBuffer], {
            type:
              resolved.kind === "video"
                ? (resolved.entry.mimeType ?? "video/*")
                : "image/webp",
          });
          if (resolved.kind === "thumbnail") item.thumbnail = blob;
          else if (resolved.kind === "preview") item.preview = blob;
          else item.video = blob;
          item.pending.delete(resolved.kind);
          if (item.pending.size === 0) {
            pending.delete(resolved.entry.photoId);
            enqueue(item);
          }
        }
      };
      entry.start();
    };

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
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (err) {
        reject(err);
      } finally {
        reader.cancel().catch(() => {});
      }
    })();
  });

  for (const item of pending.values()) {
    result.failed++;
    result.errors.push({
      id: item.entry.photoId,
      error: "動画アーカイブ内のファイルが不足しています",
    });
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
