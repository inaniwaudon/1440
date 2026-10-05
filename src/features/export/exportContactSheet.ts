import { db } from "../../db/db";
import { formatMinuteOfDay } from "../../utils/time";

const CELL_SIZE = 240;
const DECODE_CONCURRENCY = 6;

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("画像の生成に失敗しました")),
      "image/jpeg",
      0.9,
    );
  });
}

export async function exportContactSheet(
  onProgress: (current: number, total: number) => void,
): Promise<{ blob: Blob; count: number }> {
  const slots = await db.slots.orderBy("minuteOfDay").toArray();
  const photos = await db.photos.bulkGet(slots.map((s) => s.photoId));
  const entries = slots.flatMap((slot, i) => {
    const photo = photos[i];
    return photo ? [{ slot, photo }] : [];
  });

  if (entries.length === 0)
    throw new Error("書き出せる写真または動画がありません");

  const columns = Math.min(
    entries.length,
    Math.max(5, Math.ceil(Math.sqrt(entries.length))),
  );
  const rows = Math.ceil(entries.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * CELL_SIZE;
  canvas.height = rows * CELL_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像用キャンバスを作成できませんでした");
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = "700 24px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";

  const bitmaps = new Array<ImageBitmap | null>(entries.length);
  let nextDecodeIndex = 0;
  const decodeWorker = async () => {
    while (true) {
      const i = nextDecodeIndex++;
      if (i >= entries.length) return;
      const { photo } = entries[i];
      try {
        bitmaps[i] = await createImageBitmap(
          photo.previewBlob ?? photo.thumbnailBlob,
        );
      } catch {
        bitmaps[i] = null;
      }
    }
  };
  const decoders = Array.from(
    { length: Math.min(DECODE_CONCURRENCY, entries.length) },
    decodeWorker,
  );

  const waiters: Array<Promise<void> | undefined> = [];
  const waitFor = (i: number): Promise<void> => {
    if (bitmaps[i] !== undefined) return Promise.resolve();
    let w = waiters[i];
    if (!w) {
      w = (async () => {
        while (bitmaps[i] === undefined) {
          await new Promise((r) => setTimeout(r, 4));
        }
      })();
      waiters[i] = w;
    }
    return w;
  };

  for (let index = 0; index < entries.length; index++) {
    onProgress(index, entries.length);
    await waitFor(index);
    const bitmap = bitmaps[index];
    const { slot } = entries[index];
    const x = (index % columns) * CELL_SIZE;
    const y = Math.floor(index / columns) * CELL_SIZE;
    if (bitmap) {
      const scale = Math.max(
        CELL_SIZE / bitmap.width,
        CELL_SIZE / bitmap.height,
      );
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, CELL_SIZE, CELL_SIZE);
      ctx.clip();
      ctx.drawImage(
        bitmap,
        x + (CELL_SIZE - width) / 2,
        y + (CELL_SIZE - height) / 2,
        width,
        height,
      );
      ctx.restore();
      bitmap.close();
    }
    ctx.fillText(
      formatMinuteOfDay(slot.minuteOfDay),
      x + 12,
      y + CELL_SIZE - 10,
    );
  }

  await Promise.all(decoders);
  onProgress(entries.length, entries.length);
  return { blob: await canvasToBlob(canvas), count: entries.length };
}
