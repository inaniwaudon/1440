import exifr from "exifr";
import { getMinuteOfDayFromDate } from "../../utils/time";
import type { PhotoRecord } from "../../db/types";

export type PhotoMetadata = {
  capturedAt: string | null;
  capturedAtSource: PhotoRecord["capturedAtSource"];
  minuteOfDay: number;
};

export async function parsePhotoMetadata(file: File): Promise<PhotoMetadata> {
  let exif: Record<string, unknown> | null = null;
  try {
    exif = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate"],
    });
  } catch {
    // EXIF parse failure is non-fatal
  }

  let capturedAt: Date;
  let capturedAtSource: PhotoRecord["capturedAtSource"];

  if (exif?.DateTimeOriginal instanceof Date) {
    capturedAt = exif.DateTimeOriginal;
    capturedAtSource = "DateTimeOriginal";
  } else if (exif?.CreateDate instanceof Date) {
    capturedAt = exif.CreateDate;
    capturedAtSource = "CreateDate";
  } else {
    capturedAt = new Date(file.lastModified);
    capturedAtSource = "lastModified";
  }

  return {
    capturedAt: capturedAt.toISOString(),
    capturedAtSource,
    minuteOfDay: getMinuteOfDayFromDate(capturedAt),
  };
}
