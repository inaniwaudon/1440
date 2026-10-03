import type { PhotoRecord, SlotRecord } from "../../db/types";

export const ARCHIVE_VERSION = 1;

export type ArchiveManifest = {
  version: number;
  exportedAt: string;
  photoCount: number;
};

export type ArchivePhotoMeta = Omit<
  PhotoRecord,
  "thumbnailBlob" | "previewBlob" | "videoBlob"
> & {
  thumbnail: string;
  preview?: string;
  video?: string;
};

export type ArchiveSlots = SlotRecord[];

export function videoExtension(mime?: string): string {
  if (!mime) return "bin";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogv";
  return "bin";
}
