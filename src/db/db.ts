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
        const migrated = slots.flatMap(({ minuteOfDay, bestPhotoId }) =>
          bestPhotoId ? [{ minuteOfDay, photoId: bestPhotoId }] : [],
        );
        const retainedPhotoIds = new Set(migrated.map((slot) => slot.photoId));
        const photos = (await tx.table("photos").toArray()) as PhotoRecord[];

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
  }
}

export const db = new AppDB();
