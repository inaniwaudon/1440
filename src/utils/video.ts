import { ArrayBufferTarget, Muxer } from "mp4-muxer";

const MAX_SIDE = 1080;
const BITRATE = 4_000_000;
const DEFAULT_FPS = 30;
const MAX_DURATION_SEC = 2;

const isWebCodecsSupported = (): boolean => {
  return (
    typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
  );
};

export const compressVideo = async (file: File): Promise<Blob> => {
  if (!isWebCodecsSupported()) {
    return file;
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Video could not be loaded"));
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) {
      return file;
    }

    const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
    const width = Math.max(2, Math.round((srcW * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcH * scale) / 2) * 2);

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width, height },
      fastStart: "in-memory",
    });

    let encoderError: unknown;
    let lastGoodDecoderConfig: VideoDecoderConfig | null = null;
    const FRAME_DURATION_US = Math.round(1_000_000 / DEFAULT_FPS);
    const DEFAULT_COLOR_SPACE: VideoColorSpaceInit = {
      primaries: "bt709",
      transfer: "bt709",
      matrix: "bt709",
      fullRange: false,
    };
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          const dc = meta?.decoderConfig;
          let patchedMeta: EncodedVideoChunkMetadata | undefined;
          if (dc) {
            const patchedDc: VideoDecoderConfig = { ...dc };
            if (!patchedDc.colorSpace) {
              patchedDc.colorSpace = DEFAULT_COLOR_SPACE;
            }
            lastGoodDecoderConfig = patchedDc;
            patchedMeta = { ...meta, decoderConfig: patchedDc };
          } else if (lastGoodDecoderConfig) {
            patchedMeta = {
              ...(meta ?? {}),
              decoderConfig: lastGoodDecoderConfig,
            };
          }

          // Safari は chunk.duration を省略するが、mp4-muxer では必須のため補完する
          const duration =
            typeof chunk.duration === "number" && chunk.duration > 0
              ? chunk.duration
              : FRAME_DURATION_US;

          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);

          muxer.addVideoChunkRaw(
            data,
            chunk.type,
            chunk.timestamp,
            duration,
            patchedMeta,
          );
        } catch (err) {
          encoderError = err;
        }
      },
      error: (err) => {
        encoderError = err;
      },
    });
    encoder.configure({
      codec: "avc1.42001f",
      width,
      height,
      bitrate: BITRATE,
      framerate: DEFAULT_FPS,
    });

    const canvas = new OffscreenCanvas(width, height);
    // biome-ignore lint/style/noNonNullAssertion: 2d context on fresh canvas
    const ctx = canvas.getContext("2d")!;

    await video.play();

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : MAX_DURATION_SEC;
    const captureUntil = Math.min(duration, MAX_DURATION_SEC);

    const rvfc =
      "requestVideoFrameCallback" in video
        ? (video as HTMLVideoElement & {
            requestVideoFrameCallback: (
              cb: (now: number, meta: { mediaTime: number }) => void,
            ) => number;
          })
        : null;

    let startMediaTime: number | null = null;
    let frameCount = 0;
    const wallStart = performance.now();
    const wallCapMs = (captureUntil + 0.5) * 1000;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(safety);
        resolve();
      };
      const safety = setTimeout(finish, wallCapMs);
      video.addEventListener("ended", finish, { once: true });

      if (!rvfc) {
        const interval = 1000 / DEFAULT_FPS;
        const timer = setInterval(() => {
          const elapsed = (performance.now() - wallStart) / 1000;
          if (elapsed >= captureUntil || done) {
            clearInterval(timer);
            finish();
            return;
          }
          ctx.drawImage(video, 0, 0, width, height);
          const frame = new VideoFrame(canvas, {
            timestamp: Math.round(elapsed * 1_000_000),
          });
          encoder.encode(frame, { keyFrame: frameCount % 60 === 0 });
          frame.close();
          frameCount++;
        }, interval);
        return;
      }

      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (done) {
          return;
        }
        if (startMediaTime === null) {
          startMediaTime = meta.mediaTime;
        }
        const mediaElapsed = meta.mediaTime - startMediaTime;
        const wallElapsed = (performance.now() - wallStart) / 1000;
        if (mediaElapsed >= captureUntil || wallElapsed >= captureUntil) {
          finish();
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.max(0, Math.round(mediaElapsed * 1_000_000)),
        });
        encoder.encode(frame, { keyFrame: frameCount % 60 === 0 });
        frame.close();
        frameCount++;
        rvfc.requestVideoFrameCallback(onFrame);
      };
      rvfc.requestVideoFrameCallback(onFrame);
    });

    video.pause();

    if (frameCount === 0) {
      return file;
    }

    await encoder.flush();
    encoder.close();
    if (encoderError) {
      throw encoderError;
    }

    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;
    const compressed = new Blob([buffer], { type: "video/mp4" });

    if (compressed.size >= file.size) {
      return file;
    }
    return compressed;
  } catch {
    return file;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
};
