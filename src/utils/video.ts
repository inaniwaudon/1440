import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { debugLog } from "./debugLog";

const MAX_SIDE = 1080;
const BITRATE = 4_000_000;
const DEFAULT_FPS = 30;
const MAX_DURATION_SEC = 2;

function isWebCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
  );
}

export async function compressVideo(file: File): Promise<Blob> {
  debugLog(
    `compressVideo start name=${file.name} type=${file.type} size=${(file.size / 1024 / 1024).toFixed(2)}MB`,
  );

  if (!isWebCodecsSupported()) {
    debugLog("WebCodecs NOT supported -> returning original");
    return file;
  }
  debugLog("WebCodecs supported");

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
    debugLog(
      `loadedmetadata duration=${video.duration} ${video.videoWidth}x${video.videoHeight}`,
    );

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) {
      debugLog("no video dimensions -> returning original");
      return file;
    }

    const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
    const width = Math.max(2, Math.round((srcW * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcH * scale) / 2) * 2);
    debugLog(`output ${width}x${height}`);

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width, height },
      fastStart: "in-memory",
    });

    let encoderError: unknown;
    let chunkIndex = 0;
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
        const idx = chunkIndex++;
        try {
          const dc = meta?.decoderConfig;
          if (idx < 2) {
            debugLog(
              `chunk#${idx} type=${chunk.type} ts=${chunk.timestamp} dur=${chunk.duration} byteLen=${chunk.byteLength}`,
            );
          }
          let patchedMeta: EncodedVideoChunkMetadata | undefined;
          if (dc) {
            const patchedDc: VideoDecoderConfig = { ...dc };
            if (!patchedDc.colorSpace)
              patchedDc.colorSpace = DEFAULT_COLOR_SPACE;
            lastGoodDecoderConfig = patchedDc;
            patchedMeta = { ...meta, decoderConfig: patchedDc };
          } else if (lastGoodDecoderConfig) {
            patchedMeta = {
              ...(meta ?? {}),
              decoderConfig: lastGoodDecoderConfig,
            };
          }

          // Safari omits chunk.duration; mp4-muxer requires it. Supply a fixed one.
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
        } catch (e) {
          encoderError = e;
          debugLog(
            `addVideoChunk threw at #${idx}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      },
      error: (e) => {
        encoderError = e;
        debugLog(`encoder error: ${e}`);
      },
    });
    encoder.configure({
      codec: "avc1.42001f",
      width,
      height,
      bitrate: BITRATE,
      framerate: DEFAULT_FPS,
    });
    debugLog("encoder configured");

    const canvas = new OffscreenCanvas(width, height);
    // biome-ignore lint/style/noNonNullAssertion: 2d context on fresh canvas
    const ctx = canvas.getContext("2d")!;

    try {
      await video.play();
      debugLog(`play() ok. currentTime=${video.currentTime}`);
    } catch (e) {
      debugLog(`play() failed: ${e}`);
      throw e;
    }

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : MAX_DURATION_SEC;
    const captureUntil = Math.min(duration, MAX_DURATION_SEC);
    debugLog(
      `captureUntil=${captureUntil}s (duration=${video.duration} finite=${Number.isFinite(video.duration)})`,
    );

    const rvfc =
      "requestVideoFrameCallback" in video
        ? (video as HTMLVideoElement & {
            requestVideoFrameCallback: (
              cb: (now: number, meta: { mediaTime: number }) => void,
            ) => number;
          })
        : null;
    debugLog(`rVFC available=${!!rvfc}`);

    let startMediaTime: number | null = null;
    let frameCount = 0;
    const wallStart = performance.now();
    const wallCapMs = (captureUntil + 0.5) * 1000;

    await new Promise<void>((resolve) => {
      let done = false;
      let finishReason = "unknown";
      const finish = (reason: string) => {
        if (done) return;
        done = true;
        finishReason = reason;
        clearTimeout(safety);
        debugLog(
          `capture finish reason=${reason} frames=${frameCount} wall=${((performance.now() - wallStart) / 1000).toFixed(2)}s`,
        );
        resolve();
      };
      const safety = setTimeout(() => finish("safety-timeout"), wallCapMs);
      video.addEventListener("ended", () => finish("ended"), { once: true });

      if (!rvfc) {
        const interval = 1000 / DEFAULT_FPS;
        const timer = setInterval(() => {
          const elapsed = (performance.now() - wallStart) / 1000;
          if (elapsed >= captureUntil || done) {
            clearInterval(timer);
            finish("fallback-cap");
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
        if (done) return;
        if (startMediaTime === null) {
          startMediaTime = meta.mediaTime;
          debugLog(`first frame mediaTime=${meta.mediaTime}`);
        }
        const mediaElapsed = meta.mediaTime - startMediaTime;
        const wallElapsed = (performance.now() - wallStart) / 1000;
        if (mediaElapsed >= captureUntil) {
          finish("media-cap");
          return;
        }
        if (wallElapsed >= captureUntil) {
          finish("wall-cap");
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.max(0, Math.round(mediaElapsed * 1_000_000)),
        });
        encoder.encode(frame, { keyFrame: frameCount % 60 === 0 });
        frame.close();
        frameCount++;
        if (frameCount % 15 === 0) {
          debugLog(
            `frame #${frameCount} media=${mediaElapsed.toFixed(2)}s wall=${wallElapsed.toFixed(2)}s`,
          );
        }
        rvfc.requestVideoFrameCallback(onFrame);
      };
      rvfc.requestVideoFrameCallback(onFrame);
      void finishReason;
    });

    video.pause();

    if (frameCount === 0) {
      debugLog("0 frames captured -> returning original");
      return file;
    }

    await encoder.flush();
    encoder.close();
    debugLog("encoder flushed");
    if (encoderError) throw encoderError;

    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;
    const compressed = new Blob([buffer], { type: "video/mp4" });
    debugLog(
      `compressed size=${(compressed.size / 1024 / 1024).toFixed(2)}MB (orig=${(file.size / 1024 / 1024).toFixed(2)}MB)`,
    );

    if (compressed.size >= file.size) {
      debugLog("compressed >= original -> returning original");
      return file;
    }
    return compressed;
  } catch (err) {
    debugLog(
      `compressVideo FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.warn("Video compression failed, using original.", err);
    return file;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
