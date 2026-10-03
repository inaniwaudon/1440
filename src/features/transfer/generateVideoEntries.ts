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

  // Process one video at a time. OPFS SyncAccessHandle flushes to disk per
  // write, so even a 1 GB video streams through without ever living fully in
  // RAM — as long as we only hold one Blob at a time here.
  for (let i = 0; i < photoIds.length; i++) {
    const id = photoIds[i];
    onProgress({ current: i, total: photoIds.length });
    let photo = await db.photos.get(id);
    if (!photo?.videoBlob) {
      photo = undefined;
      continue;
    }
    const path = `videos/${id}.${videoExtension(photo.mimeType)}`;
    entries.push({ photoId: id, path, mimeType: photo.mimeType });
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
