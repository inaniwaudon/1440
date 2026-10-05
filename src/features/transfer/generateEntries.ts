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

// ジェネレータ関数はアロー関数で表現できないため function 宣言を使用する
export async function* generateEntries(
  photoIds: string[],
  slots: SlotRecord[],
  onProgress: (progress: ExportProgress) => void,
): AsyncGenerator<ZipEntry> {
  const now = new Date();
  const metas: ArchivePhotoMeta[] = [];

  // 冒頭にバージョンマーカーを出力し、未対応のアーカイブに対して
  // ファイル全体を走査する前に消費側が早期に中断できるようにする
  yield {
    name: "version.json",
    lastModified: now,
    input: JSON.stringify({ version: ARCHIVE_VERSION, kind: "main" }),
  };

  // シングルパスで各写真をちょうど 1 回だけ読み込み、Blob を yield し、次に進む前にレコードを解放する。
  // 初回パスでメタ情報の構築を分離して行わないことで、Safari が IndexedDB の get 時に生成された
  // Blob 参照を保持し続けるのを回避する。
  //
  // 動画は意図的にメインアーカイブから除外し、別途動画アーカイブとして出力することで、
  // iOS Safari の PWA における ZIP 1 つあたりのメモリ使用量を抑える。
  for (let i = 0; i < photoIds.length; i++) {
    const id = photoIds[i];
    onProgress({ current: i, total: photoIds.length });
    let photo = await db.photos.get(id);
    if (!photo) {
      continue;
    }

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

    // 参照を破棄し、次の get() の前に Safari が IndexedDB から取得したバイト列を回収可能にする
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
