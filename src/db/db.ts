import Dexie, { type Table } from "dexie";
import type { PhotoRecord, SlotRecord } from "./types";

class AppDB extends Dexie {
  photos!: Table<PhotoRecord, string>;
  slots!: Table<SlotRecord, number>;

  constructor() {
    super("minute-photo-app");
    this.version(1).stores({
      photos: "id, minuteOfDay, capturedAt, importedAt",
      slots: "minuteOfDay, bestPhotoId",
    });

    this.version(2)
      .stores({
        photos: "id, minuteOfDay, capturedAt, importedAt",
        slots: "minuteOfDay, photoId",
      })
      .upgrade(async (tx) => {
        const slots = (await tx.table("slots").toArray()) as Array<{
          minuteOfDay: number;
          bestPhotoId?: string;
        }>;
        const photos = (await tx.table("photos").toArray()) as PhotoRecord[];
        const existingPhotoIds = new Set(photos.map((p) => p.id));
        // Drop slots that reference a missing photo to avoid dangling pointers.
        const migrated = slots.flatMap(({ minuteOfDay, bestPhotoId }) =>
          bestPhotoId && existingPhotoIds.has(bestPhotoId)
            ? [{ minuteOfDay, photoId: bestPhotoId }]
            : [],
        );
        const retainedPhotoIds = new Set(migrated.map((slot) => slot.photoId));

        await tx.table("slots").clear();
        await tx.table("slots").bulkPut(migrated);
        await tx
          .table("photos")
          .bulkDelete(
            photos
              .filter((photo) => !retainedPhotoIds.has(photo.id))
              .map((photo) => photo.id),
          );
      });

    this.version(3)
      .stores({
        photos: "id, minuteOfDay, capturedAt, importedAt",
        slots: "minuteOfDay, photoId",
      })
      .upgrade(async (tx) => {
        const photos = (await tx.table("photos").toArray()) as PhotoRecord[];
        const needsBackfill = photos.filter(
          (photo) =>
            (photo.originalWidth === undefined ||
              photo.originalHeight === undefined) &&
            !!(photo.previewBlob ?? photo.thumbnailBlob),
        );
        for (const photo of needsBackfill) {
          try {
            const bitmap = await createImageBitmap(
              photo.previewBlob ?? photo.thumbnailBlob,
            );
            try {
              photo.originalWidth = bitmap.width;
              photo.originalHeight = bitmap.height;
            } finally {
              bitmap.close();
            }
          } catch {
            // Blob unreadable — leave unset; UI already handles the optional case.
          }
        }
        if (needsBackfill.length > 0) {
          await tx.table("photos").bulkPut(needsBackfill);
        }
      });
  }
}

export const db = new AppDB();
