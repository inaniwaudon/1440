import { db } from "../../db/db";
import {
  ARCHIVE_VERSION,
  type VideoArchiveEntry,
  type VideoArchiveManifest,
  videoExtension,
} from "./archive";
import type { ExportProgress, ZipEntry } from "./generateEntries";

export async function* generateVideoEntries(
  photoIds: string[],
  onProgress: (p: ExportProgress) => void,
): AsyncGenerator<ZipEntry> {
  const now = new Date();
  const entries: VideoArchiveEntry[] = [];

  yield {
    name: "version.json",
    lastModified: now,
    input: JSON.stringify({ version: ARCHIVE_VERSION, kind: "video" }),
  };

  // 動画を 1 件ずつ処理する。OPFS SyncAccessHandle は書き込みごとにディスクへフラッシュするため、
  // ここで同時に保持する Blob を 1 つに限る限り、1 GB の動画でも全体を RAM に載せずにストリーム処理できる。
  for (let i = 0; i < photoIds.length; i++) {
    const id = photoIds[i];
    onProgress({ current: i, total: photoIds.length });
    let photo = await db.photos.get(id);
    if (!photo?.videoBlob) {
      photo = undefined;
      continue;
    }
    const basePath = `videos/${id}`;
    const path = `${basePath}/video.${videoExtension(photo.mimeType)}`;
    const thumbnailPath = `${basePath}/thumbnail.bin`;
    const previewPath = photo.previewBlob
      ? `${basePath}/preview.bin`
      : undefined;
    const slot = await db.slots.get(photo.minuteOfDay);
    entries.push({
      photoId: id,
      path,
      mimeType: photo.mimeType,
      photo: {
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
        video: path,
      },
      slot:
        slot?.photoId === id
          ? slot
          : { minuteOfDay: photo.minuteOfDay, photoId: id },
    });
    yield {
      name: thumbnailPath,
      lastModified: now,
      input: photo.thumbnailBlob,
    };
    if (previewPath && photo.previewBlob) {
      yield { name: previewPath, lastModified: now, input: photo.previewBlob };
    }
    yield { name: path, lastModified: now, input: photo.videoBlob };
    photo = undefined;
  }

  const manifest: VideoArchiveManifest = {
    version: ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    videos: entries,
  };

  yield {
    name: "video-manifest.json",
    lastModified: now,
    input: JSON.stringify(manifest),
  };

  onProgress({ current: photoIds.length, total: photoIds.length });
}
