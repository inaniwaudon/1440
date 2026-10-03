async function resizeToBlob(
  file: File,
  maxSide: number,
  quality: number,
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // imageOrientation:'from-image' applies EXIF rotation automatically.
    // Not supported in all environments — fall back without it.
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    bitmap = await createImageBitmap(file);
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  // biome-ignore lint/style/noNonNullAssertion: 2d context is always available for a fresh canvas
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        // WebP not supported — fall back to JPEG
        canvas.toBlob(
          (jpegBlob) =>
            jpegBlob
              ? resolve(jpegBlob)
              : reject(
                  new Error("canvas.toBlob failed for both WebP and JPEG"),
                ),
          "image/jpeg",
          quality,
        );
      },
      "image/webp",
      quality,
    );
  });
}

export async function createThumbnail(file: File): Promise<Blob> {
  return resizeToBlob(file, 320, 0.78);
}

export async function createPreview(file: File): Promise<Blob> {
  return resizeToBlob(file, 2000, 0.85);
}

export async function createVideoThumbnail(file: File): Promise<Blob> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Video could not be decoded"));
      video.load();
    });

    if (Number.isFinite(video.duration) && video.duration > 0.1) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = Math.min(0.1, video.duration / 2);
      });
    }

    const scale = Math.min(
      1,
      320 / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Video thumbnail creation failed")),
        "image/webp",
        0.78,
      );
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
