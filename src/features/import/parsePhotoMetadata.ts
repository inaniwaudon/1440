import exifr from "exifr";
import type { PhotoRecord } from "../../db/types";
import { getMinuteOfDayFromDate } from "../../utils/time";

export type PhotoMetadata = {
  capturedAt: string | null;
  capturedAtSource: PhotoRecord["capturedAtSource"];
  minuteOfDay: number;
};

export const parsePhotoMetadata = async (
  file: File,
): Promise<PhotoMetadata> => {
  let exif: Record<string, unknown> | null = null;
  try {
    exif = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate"],
    });
  } catch {
    // EXIF の解析失敗は致命的ではないため無視
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

  // lastModified はタイムゾーン情報を持たないため、UTC の時刻を
  // そのままスロットとして扱う。EXIF 由来の場合はローカル時刻として解釈する
  const minuteOfDay =
    capturedAtSource === "lastModified"
      ? capturedAt.getUTCHours() * 60 + capturedAt.getUTCMinutes()
      : getMinuteOfDayFromDate(capturedAt);

  return {
    capturedAt: capturedAt.toISOString(),
    capturedAtSource,
    minuteOfDay,
  };
};
