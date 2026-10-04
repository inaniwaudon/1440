import { db } from "../../db/db";
import type { SlotRecord } from "../../db/types";
import {
  ARCHIVE_VERSION,
  type ArchiveManifest,
  type ArchivePhotoMeta,
} from "./archive";

export type ExportProgress = { current: number; total: number };
export type ZipEntry = {
  name: string;
  lastModified: Date;
  input: Blob | string;
};

export async function* generateEntries(
  photoIds: string[],
  slots: SlotRecord[],
  onProgress: (p: ExportProgress) => void,
): AsyncGenerator<ZipEntry> {
  const now = new Date();
  const metas: ArchivePhotoMeta[] = [];

  // Emit a version marker up front so consumers can bail out early on
  // unsupported archives before scanning the whole file.
  yield {
    name: "version.json",
    lastModified: now,
    input: JSON.stringify({ version: ARCHIVE_VERSION, kind: "main" }),
  };

  // Single pass: read each photo exactly once, yield its blobs, release the
  // record before advancing. Keeping the first-pass meta build out of the way
  // avoids Safari holding onto Blob references materialized by IndexedDB gets.
  //
  // Videos are intentionally omitted from the main archive and shipped in a
  // separate video archive to keep the per-ZIP memory footprint bounded on
  // iOS Safari PWA.
  for (let i = 0; i < photoIds.length; i++) {
    const id = photoIds[i];
    onProgress({ current: i, total: photoIds.length });
    let photo = await db.photos.get(id);
    if (!photo) continue;

    const thumbnailPath = `photos/${id}/thumbnail.bin`;
    const previewPath = photo.previewBlob
      ? `photos/${id}/preview.bin`
      : undefined;

    metas.push({
      id: photo.id,
      capturedAt: photo.capturedAt,
      minuteOfDay: photo.minuteOfDay,
      originalFileName: photo.originalFileName,
      mimeType: photo.mimeType,
      originalWidth: photo.originalWidth,
      originalHeight: photo.originalHeight,
      hasDetectedFace: photo.hasDetectedFace,
      blurOverride: photo.blurOverride,
      importedAt: photo.importedAt,
      capturedAtSource: photo.capturedAtSource,
      thumbnail: thumbnailPath,
      preview: previewPath,
      video: photo.videoBlob ? "external" : undefined,
    });

    yield {
      name: thumbnailPath,
      lastModified: now,
      input: photo.thumbnailBlob,
    };
    if (previewPath && photo.previewBlob) {
      yield { name: previewPath, lastModified: now, input: photo.previewBlob };
    }

    // Drop references so Safari IndexedDB-materialized bytes can be collected
    // before the next get().
    photo = undefined;
  }

  const manifest: ArchiveManifest = {
    version: ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    photoCount: metas.length,
  };

  yield {
    name: "manifest.json",
    lastModified: now,
    input: JSON.stringify(manifest),
  };
  yield {
    name: "photos.json",
    lastModified: now,
    input: JSON.stringify(metas),
  };
  yield { name: "slots.json", lastModified: now, input: JSON.stringify(slots) };

  onProgress({ current: photoIds.length, total: photoIds.length });
}
