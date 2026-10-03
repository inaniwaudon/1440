import { db } from "../../db/db";

const CELL_SIZE = 240;

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("画像の生成に失敗しました")),
      "image/png",
    );
  });
}

export async function exportContactSheet(
  onProgress: (current: number, total: number) => void,
): Promise<{ blob: Blob; count: number }> {
  const slots = await db.slots.orderBy("minuteOfDay").toArray();
  const entries = (await Promise.all(
    slots.map(async (slot) => ({ slot, photo: await db.photos.get(slot.photoId) })),
  )).filter((entry) => !!entry.photo);

  if (entries.length === 0) throw new Error("書き出せる画像または動画がありません");

  // Keep small exports timeline-like while preventing an excessively tall
  // canvas when a full day contains many entries.
  const columns = Math.min(entries.length, Math.max(5, Math.ceil(Math.sqrt(entries.length))));
  const rows = Math.ceil(entries.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * CELL_SIZE;
  canvas.height = rows * CELL_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像用キャンバスを作成できませんでした");
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < entries.length; index++) {
    onProgress(index, entries.length);
    const { slot, photo } = entries[index];
    if (!photo) continue;
    const bitmap = await createImageBitmap(photo.previewBlob ?? photo.thumbnailBlob);
    try {
      const x = (index % columns) * CELL_SIZE;
      const y = Math.floor(index / columns) * CELL_SIZE;
      const scale = Math.max(CELL_SIZE / bitmap.width, CELL_SIZE / bitmap.height);
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
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const hour = Math.floor(slot.minuteOfDay / 60);
      const minute = slot.minuteOfDay % 60;
      ctx.fillText(
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        x + 12,
        y + CELL_SIZE - 10,
      );
      ctx.restore();
    } finally {
      bitmap.close();
    }
    if ((index + 1) % 10 === 0) await new Promise(requestAnimationFrame);
  }

  onProgress(entries.length, entries.length);
  return { blob: await canvasToBlob(canvas), count: entries.length };
}
