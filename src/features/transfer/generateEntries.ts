import { db } from "../../db/db";
import type { SlotRecord } from "../../db/types";
import {
  ARCHIVE_VERSION,
  type ArchiveManifest,
  type ArchivePhotoMeta,
  videoExtension,
} from "./archive";

export type ExportProgress = { current: number; total: number };
export type ZipEntry = { name: string; lastModified: Date; input: Blob | string };

export async function* generateEntries(
  photoIds: string[],
  slots: SlotRecord[],
  onProgress: (p: ExportProgress) => void,
): AsyncGenerator<ZipEntry> {
  const now = new Date();
  const metas: ArchivePhotoMeta[] = [];

  const layout = photoIds.map((id) => ({
    id,
    thumbnailPath: `photos/${id}/thumbnail.bin`,
    previewPath: `photos/${id}/preview.bin`,
  }));

  for (const { id, thumbnailPath, previewPath } of layout) {
    const photo = await db.photos.get(id);
    if (!photo) continue;
    metas.push({
      id: photo.id,
      capturedAt: photo.capturedAt,
      minuteOfDay: photo.minuteOfDay,
      originalFileName: photo.originalFileName,
      mimeType: photo.mimeType,
      originalWidth: photo.originalWidth,
      originalHeight: photo.originalHeight,
      importedAt: photo.importedAt,
      capturedAtSource: photo.capturedAtSource,
      thumbnail: thumbnailPath,
      preview: photo.previewBlob ? previewPath : undefined,
      video: photo.videoBlob
        ? `photos/${photo.id}/video.${videoExtension(photo.mimeType)}`
        : undefined,
    });
  }

  const manifest: ArchiveManifest = {
    version: ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    photoCount: metas.length,
  };

  yield { name: "manifest.json", lastModified: now, input: JSON.stringify(manifest) };
  yield { name: "photos.json", lastModified: now, input: JSON.stringify(metas) };
  yield { name: "slots.json", lastModified: now, input: JSON.stringify(slots) };

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    onProgress({ current: i, total: metas.length });
    const photo = await db.photos.get(meta.id);
    if (!photo) continue;

    yield { name: meta.thumbnail, lastModified: now, input: photo.thumbnailBlob };
    if (meta.preview && photo.previewBlob) {
      yield { name: meta.preview, lastModified: now, input: photo.previewBlob };
    }
    if (meta.video && photo.videoBlob) {
      yield { name: meta.video, lastModified: now, input: photo.videoBlob };
    }
  }

  onProgress({ current: metas.length, total: metas.length });
}
