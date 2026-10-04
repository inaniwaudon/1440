import { db } from "../../db/db";
import type { PhotoRecord } from "../../db/types";
import {
  createPreview,
  createThumbnail,
  createVideoThumbnail,
} from "../../utils/image";
import { getMinuteOfDayFromDate } from "../../utils/time";
import { compressVideo } from "../../utils/video";
import { shouldBlurForFaces } from "../privacy/faceDetector";
import { parsePhotoMetadata } from "./parsePhotoMetadata";

export type ImportProgress = {
  total: number;
  current: number;
  currentFile: string;
};

export type ImportResult = {
  succeeded: number;
  skipped: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
};

type ImportCandidate = {
  fileName: string;
  mimeType: string;
  capturedAt: string | null;
  capturedAtSource: PhotoRecord["capturedAtSource"];
  thumbnailBlob: Blob;
};

export type ImportConflict = {
  minuteOfDay: number;
  existing: PhotoRecord;
  incoming: ImportCandidate;
};

type ConflictResolver = (
  conflict: ImportConflict,
) => boolean | Promise<boolean>;

async function savePhoto(
  file: File,
  meta: {
    capturedAt: string | null;
    capturedAtSource: PhotoRecord["capturedAtSource"];
    minuteOfDay: number;
  },
  resolveConflict?: ConflictResolver,
): Promise<boolean> {
  const existingSlot = await db.slots.get(meta.minuteOfDay);
  const isVideo = file.type.startsWith("video/");
  const [thumbnailBlob, previewBlob, videoBlob] = isVideo
    ? [await createVideoThumbnail(file), undefined, await compressVideo(file)]
    : [
        ...(await Promise.all([createThumbnail(file), createPreview(file)])),
        undefined,
      ];

  if (existingSlot?.photoId) {
    const existing = await db.photos.get(existingSlot.photoId);
    if (
      existing &&
      resolveConflict &&
      !(await resolveConflict({
        minuteOfDay: meta.minuteOfDay,
        existing,
        incoming: {
          fileName: file.name,
          mimeType: file.type || (isVideo ? "video/*" : "image/*"),
          capturedAt: meta.capturedAt,
          capturedAtSource: meta.capturedAtSource,
          thumbnailBlob,
        },
      }))
    ) {
      return false;
    }
  }

  const id =
    crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const hasDetectedFace = await shouldBlurForFaces(thumbnailBlob);
  const record: PhotoRecord = {
    id,
    capturedAt: meta.capturedAt,
    minuteOfDay: meta.minuteOfDay,
    thumbnailBlob,
    previewBlob,
    videoBlob: isVideo ? videoBlob : undefined,
    originalFileName: file.name,
    mimeType: isVideo
      ? videoBlob?.type || file.type || "video/*"
      : previewBlob?.type || "image/webp",
    hasDetectedFace,
    importedAt: new Date().toISOString(),
    capturedAtSource: meta.capturedAtSource,
  };

  await db.transaction("rw", db.photos, db.slots, async () => {
    // A minute has exactly one photo. Re-importing replaces the existing one.
    await db.photos.where("minuteOfDay").equals(meta.minuteOfDay).delete();
    await db.photos.add(record);
    await db.slots.put({ minuteOfDay: meta.minuteOfDay, photoId: id });
  });
  return true;
}

export async function importCameraPhoto(
  file: File,
  resolveConflict?: ConflictResolver,
): Promise<boolean> {
  const now = new Date();
  return savePhoto(
    file,
    {
      capturedAt: now.toISOString(),
      capturedAtSource: "currentTime",
      minuteOfDay: getMinuteOfDayFromDate(now),
    },
    resolveConflict,
  );
}

export async function importLibraryPhoto(
  file: File,
  resolveConflict?: ConflictResolver,
): Promise<boolean> {
  const meta = await parsePhotoMetadata(file);
  return savePhoto(file, meta, resolveConflict);
}

export async function importBulkPhotos(
  files: File[],
  onProgress: (p: ImportProgress) => void,
  resolveConflict?: ConflictResolver,
): Promise<ImportResult> {
  const result: ImportResult = {
    succeeded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({ total: files.length, current: i, currentFile: file.name });

    try {
      const imported = await importLibraryPhoto(file, resolveConflict);
      if (imported) result.succeeded++;
      else result.skipped++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        file: file.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Yield to event loop every 5 files to keep UI responsive
    if ((i + 1) % 5 === 0) {
      await new Promise(requestAnimationFrame);
    }
  }

  onProgress({ total: files.length, current: files.length, currentFile: "" });
  return result;
}
