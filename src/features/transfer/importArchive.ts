import {
  BlobReader,
  BlobWriter,
  type Entry,
  type FileEntry,
  TextWriter,
  ZipReader,
} from "@zip.js/zip.js";
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

const asFile = (entry: Entry): FileEntry => {
  if (entry.directory) {
    throw new Error("ZIP エントリを読み込めませんでした");
  }
  return entry as FileEntry;
};

const readJsonEntry = async <T>(
  entry: Entry,
  validate: (value: unknown) => value is T,
): Promise<T> => {
  const text = await asFile(entry).getData(new TextWriter());
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${entry.filename} は有効な JSON ではありません`);
  }
  if (!validate(parsed)) {
    throw new Error(`${entry.filename} の形式が不正です`);
  }
  return parsed;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isArchiveManifest = (value: unknown): value is ArchiveManifest => {
  return (
    isObject(value) &&
    typeof value.version === "number" &&
    typeof value.exportedAt === "string" &&
    typeof value.photoCount === "number"
  );
};

const isVideoArchiveManifest = (
  value: unknown,
): value is VideoArchiveManifest => {
  return (
    isObject(value) &&
    typeof value.version === "number" &&
    typeof value.exportedAt === "string" &&
    Array.isArray(value.videos) &&
    value.videos.every(
      (entry) =>
        isObject(entry) &&
        typeof entry.photoId === "string" &&
        typeof entry.path === "string",
    )
  );
};

const isArchivePhotoMetaArray = (
  value: unknown,
): value is ArchivePhotoMeta[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (photo) =>
        isObject(photo) &&
        typeof photo.id === "string" &&
        typeof photo.minuteOfDay === "number" &&
        typeof photo.thumbnail === "string",
    )
  );
};

const isSlotRecordArray = (value: unknown): value is SlotRecord[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (slot) =>
        isObject(slot) &&
        typeof slot.minuteOfDay === "number" &&
        typeof slot.photoId === "string",
    )
  );
};

const readBlobEntry = async (entry: Entry, type: string): Promise<Blob> => {
  return await asFile(entry).getData(new BlobWriter(type));
};

export const readArchiveMetadata = async (
  file: File,
): Promise<AnyArchiveSummary> => {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const byName = new Map<string, Entry>();
    for (const entry of entries) {
      if (METADATA_FILES.has(entry.filename)) {
        byName.set(entry.filename, entry);
      }
    }

    const videoManifestEntry = byName.get("video-manifest.json");
    if (videoManifestEntry) {
      const manifest = await readJsonEntry(
        videoManifestEntry,
        isVideoArchiveManifest,
      );
      if (manifest.version > ARCHIVE_VERSION) {
        throw new Error(
          `このアプリケーションは アーカイブバージョン ${manifest.version} に対応していません`,
        );
      }
      return { kind: "video", manifest };
    }

    const manifestEntry = byName.get("manifest.json");
    const photosEntry = byName.get("photos.json");
    const slotsEntry = byName.get("slots.json");
    if (!manifestEntry || !photosEntry || !slotsEntry) {
      throw new Error("アーカイブに必要なメタデータが含まれていません");
    }
    const [manifest, photos, slots] = await Promise.all([
      readJsonEntry(manifestEntry, isArchiveManifest),
      readJsonEntry(photosEntry, isArchivePhotoMetaArray),
      readJsonEntry(slotsEntry, isSlotRecordArray),
    ]);
    if (manifest.version > ARCHIVE_VERSION) {
      throw new Error(
        `このアプリケーションは アーカイブバージョン ${manifest.version} に対応していません`,
      );
    }
    return { kind: "main", manifest, photos, slots };
  } finally {
    await reader.close();
  }
};

export const importArchive = async (
  file: File,
  summary: ArchiveSummary,
  onProgress: (progress: ImportArchiveProgress) => void,
): Promise<ImportArchiveResult> => {
  const result: ImportArchiveResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const slotsByPhotoId = new Map<string, SlotRecord>();
  for (const slot of summary.slots) {
    slotsByPhotoId.set(slot.photoId, slot);
  }

  const total = summary.photos.length;
  onProgress({ current: 0, total, phase: "write" });

  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const entryByName = new Map<string, Entry>();
    for (const entry of entries) {
      entryByName.set(entry.filename, entry);
    }

    for (const meta of summary.photos) {
      const slot = slotsByPhotoId.get(meta.id);
      if (!slot) {
        result.skipped++;
        onProgress({
          current: result.imported + result.skipped + result.failed,
          total,
          phase: "write",
        });
        continue;
      }

      try {
        const thumbnailEntry = entryByName.get(meta.thumbnail);
        if (!thumbnailEntry) {
          throw new Error("サムネイルが欠けています");
        }
        // サムネイルやプレビューは、元写真の mimeType にかかわらず常に WebP であるため、
        // 例えば "video/mp4" を付与すると <img> の描画が破綻する
        const thumbnail = await readBlobEntry(thumbnailEntry, "image/webp");

        let preview: Blob | undefined;
        if (meta.preview) {
          const previewEntry = entryByName.get(meta.preview);
          if (previewEntry) {
            preview = await readBlobEntry(previewEntry, "image/webp");
          }
        }

        const hasDetectedFace = meta.hasDetectedFace ?? false;
        await db.transaction("rw", db.photos, db.slots, async () => {
          // 同一 photo id に既存の動画がある場合はそれを残して後からの動画アーカイブ取り込みでも紐付けられるようにする。
          // メインアーカイブのみを再取り込みした際に動画を失わないようにする。
          const existing = await db.photos.get(meta.id);
          const record: PhotoRecord = {
            id: meta.id,
            capturedAt: meta.capturedAt,
            minuteOfDay: meta.minuteOfDay,
            thumbnailBlob: thumbnail,
            previewBlob: preview,
            videoBlob: existing?.videoBlob,
            originalFileName: meta.originalFileName,
            mimeType: meta.mimeType,
            originalWidth: meta.originalWidth,
            originalHeight: meta.originalHeight,
            hasDetectedFace,
            blurOverride: meta.blurOverride,
            importedAt: meta.importedAt,
            capturedAtSource: meta.capturedAtSource,
          };
          await db.photos
            .where("minuteOfDay")
            .equals(slot.minuteOfDay)
            .delete();
          await db.photos.put(record);
          await db.slots.put({
            minuteOfDay: slot.minuteOfDay,
            photoId: meta.id,
          });
        });
        result.imported++;
      } catch (err) {
        result.failed++;
        result.errors.push({
          id: meta.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      onProgress({
        current: result.imported + result.skipped + result.failed,
        total,
        phase: "write",
      });
    }
  } finally {
    await reader.close();
  }

  onProgress({
    current: result.imported + result.skipped + result.failed,
    total,
    phase: "write",
  });
  return result;
};

export const importVideoArchive = async (
  file: File,
  summary: VideoArchiveSummary,
  onProgress: (progress: ImportArchiveProgress) => void,
): Promise<ImportArchiveResult> => {
  const result: ImportArchiveResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const total = summary.manifest.videos.length;
  onProgress({ current: 0, total, phase: "write" });

  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const entryByName = new Map<string, Entry>();
    for (const entry of entries) {
      entryByName.set(entry.filename, entry);
    }

    for (const entry of summary.manifest.videos) {
      try {
        await writeVideo(entry, entryByName, result);
      } catch (err) {
        result.failed++;
        result.errors.push({
          id: entry.photoId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      onProgress({
        current: result.imported + result.skipped + result.failed,
        total,
        phase: "write",
      });
    }
  } finally {
    await reader.close();
  }

  onProgress({
    current: result.imported + result.skipped + result.failed,
    total,
    phase: "write",
  });
  return result;
};

const writeVideo = async (
  entry: VideoArchiveEntry,
  entryByName: Map<string, Entry>,
  result: ImportArchiveResult,
): Promise<void> => {
  const videoEntry = entryByName.get(entry.path);
  if (!videoEntry) {
    throw new Error("動画ファイルが欠けています");
  }
  const videoType = entry.mimeType ?? "video/mp4";
  const video = await readBlobEntry(videoEntry, videoType);

  const existing = await db.photos.get(entry.photoId);

  if (!entry.photo || !entry.slot) {
    // 旧形式の動画アーカイブは単独の写真メタデータを持たないため、
    // 既に復元済みのメインレコードにしか紐付けられない
    if (existing) {
      await db.photos.put({
        ...existing,
        videoBlob: video,
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

  const thumbnailEntry = entryByName.get(entry.photo.thumbnail);
  if (!thumbnailEntry) {
    throw new Error("サムネイルが欠けています");
  }
  const thumbnail = await readBlobEntry(thumbnailEntry, "image/webp");

  let preview: Blob | undefined;
  if (entry.photo.preview) {
    const previewEntry = entryByName.get(entry.photo.preview);
    if (previewEntry) {
      preview = await readBlobEntry(previewEntry, "image/webp");
    }
  }

  const hasDetectedFace = meta.hasDetectedFace ?? false;
  const record: PhotoRecord = {
    id: meta.id,
    capturedAt: meta.capturedAt,
    minuteOfDay: meta.minuteOfDay,
    thumbnailBlob: thumbnail,
    previewBlob: preview,
    videoBlob: video,
    originalFileName: meta.originalFileName,
    mimeType: entry.mimeType ?? meta.mimeType,
    originalWidth: meta.originalWidth,
    originalHeight: meta.originalHeight,
    hasDetectedFace,
    blurOverride: meta.blurOverride,
    importedAt: meta.importedAt,
    capturedAtSource: meta.capturedAtSource,
  };
  await db.transaction("rw", db.photos, db.slots, async () => {
    await db.photos.where("minuteOfDay").equals(slot.minuteOfDay).delete();
    await db.photos.put(record);
    await db.slots.put(slot);
  });
  result.imported++;
};
