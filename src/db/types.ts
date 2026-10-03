export type MinuteOfDay = number; // 0..1439

export type PhotoRecord = {
  id: string;
  capturedAt: string | null;
  minuteOfDay: number;
  thumbnailBlob: Blob;
  previewBlob?: Blob;
  videoBlob?: Blob;
  originalFileName?: string;
  mimeType?: string;
  originalWidth?: number;
  originalHeight?: number;
  importedAt: string;
  capturedAtSource:
    | "DateTimeOriginal"
    | "CreateDate"
    | "lastModified"
    | "currentTime"
    | "manual";
};

export type SlotRecord = {
  minuteOfDay: number;
  photoId: string;
};
