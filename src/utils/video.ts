import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  createFile,
  DataStream,
  Endianness,
  type ISOFile,
  type Sample,
} from "mp4box";

const MAX_SIDE = 1080;
const BITRATE = 4_000_000;
const DEFAULT_FPS = 30;
const MAX_DURATION_SEC = 2;

const isWebCodecsSupported = (): boolean => {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
};

// mp4box の sample entry から VideoDecoder 用の description を取り出す
const extractDescription = (
  file: ISOFile,
  trackId: number,
): Uint8Array | undefined => {
  const trak = file.getTrackById(trackId);
  // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
  const entries = (trak as any)?.mdia?.minf?.stbl?.stsd?.entries;
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const entry = entries[0];
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) {
    return undefined;
  }
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer.slice(8));
};

// ファイルを demux して video track 情報とサンプル列を取得する
interface DemuxResult {
  config: VideoDecoderConfig;
  samples: Sample[];
  timescale: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

// mp4 の matrix (9要素の固定小数点) から回転角度を取り出す
const matrixToRotation = (
  matrix: ArrayLike<number> | undefined,
): 0 | 90 | 180 | 270 => {
  if (!matrix || matrix.length < 2) {
    return 0;
  }
  // 上位 2 要素は 16.16 固定小数点、a=cosθ, b=sinθ
  const a = matrix[0] / 65536;
  const b = matrix[1] / 65536;
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) {
    return 90;
  }
  if (normalized >= 135 && normalized < 225) {
    return 180;
  }
  if (normalized >= 225 && normalized < 315) {
    return 270;
  }
  return 0;
};

const demux = async (file: File): Promise<DemuxResult> => {
  const buffer = await file.arrayBuffer();
  const mp4 = createFile();

  return new Promise<DemuxResult>((resolve, reject) => {
    const collected: Sample[] = [];
    let resolved = false;

    mp4.onError = (err: string) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`mp4box error: ${err}`));
      }
    };

    // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
    mp4.onReady = (info: any) => {
      const track = info.videoTracks?.[0];
      if (!track) {
        reject(new Error("No video track found"));
        return;
      }
      const description = extractDescription(mp4, track.id);
      const config: VideoDecoderConfig = {
        codec: track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description,
      };
      mp4.setExtractionOptions(track.id, null, { nbSamples: 1000 });
      // onReady の中で config を保持し、onSamples 完了後に解決する
      (mp4 as unknown as { __config: VideoDecoderConfig }).__config = config;
      (mp4 as unknown as { __track: typeof track }).__track = track;
      mp4.start();
    };

    mp4.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
      for (const sample of samples) {
        collected.push(sample);
      }
      // 2 秒分 + 余裕を集めたら完了とみなす
      const track = (mp4 as unknown as { __track: { timescale: number } })
        .__track;
      if (!track) {
        return;
      }
      const lastDtsSec = samples[samples.length - 1].cts / track.timescale;
      if (lastDtsSec >= MAX_DURATION_SEC + 0.5 && !resolved) {
        resolved = true;
        const config = (mp4 as unknown as { __config: VideoDecoderConfig })
          .__config;
        resolve({
          config,
          samples: collected,
          timescale: track.timescale,
          // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
          width: (track as any).video.width,
          // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
          height: (track as any).video.height,
          // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
          rotation: matrixToRotation((track as any).matrix),
        });
      }
    };

    // biome-ignore lint/suspicious/noExplicitAny: appendBuffer は MP4BoxBuffer を要求
    const buf = buffer as any;
    buf.fileStart = 0;
    mp4.appendBuffer(buf);
    mp4.flush();

    // flush 後に完了していない場合、集まったサンプルで解決する
    if (!resolved) {
      resolved = true;
      const config = (mp4 as unknown as { __config?: VideoDecoderConfig })
        .__config;
      const track = (mp4 as unknown as { __track?: { timescale: number } })
        .__track;
      if (!config || !track) {
        reject(new Error("Failed to extract video config"));
        return;
      }
      resolve({
        config,
        samples: collected,
        timescale: track.timescale,
        // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
        width: ((mp4 as any).__track as any).video.width,
        // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
        height: ((mp4 as any).__track as any).video.height,
        // biome-ignore lint/suspicious/noExplicitAny: mp4box の型が不完全
        rotation: matrixToRotation(((mp4 as any).__track as any).matrix),
      });
    }
  });
};

export const compressVideo = async (file: File): Promise<Blob> => {
  if (!isWebCodecsSupported()) {
    return file;
  }

  try {
    const {
      config,
      samples,
      timescale,
      width: srcW,
      height: srcH,
      rotation,
    } = await demux(file);

    // 対応コーデックか確認する
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      return file;
    }

    const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
    const width = Math.max(2, Math.round((srcW * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcH * scale) / 2) * 2);

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width, height, rotation },
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

    const needsResize = width !== srcW || height !== srcH;
    let frameIndex = 0;
    let decoderError: unknown;

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const timestampSec = frame.timestamp / 1_000_000;
          if (timestampSec >= MAX_DURATION_SEC) {
            frame.close();
            return;
          }
          let encodedFrame: VideoFrame;
          if (needsResize) {
            ctx.drawImage(frame, 0, 0, width, height);
            encodedFrame = new VideoFrame(canvas, {
              timestamp: frame.timestamp,
              duration: FRAME_DURATION_US,
            });
            frame.close();
          } else {
            encodedFrame = frame;
          }
          encoder.encode(encodedFrame, { keyFrame: frameIndex % 60 === 0 });
          encodedFrame.close();
          frameIndex++;
        } catch (err) {
          decoderError = err;
          frame.close();
        }
      },
      error: (err) => {
        decoderError = err;
      },
    });
    decoder.configure(config);

    // 2 秒以内のサンプルのみデコードに流す
    const maxCts = MAX_DURATION_SEC * timescale;
    for (const sample of samples) {
      if (sample.cts >= maxCts) {
        break;
      }
      if (!sample.data) {
        continue;
      }
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? "key" : "delta",
        timestamp: (sample.cts * 1_000_000) / timescale,
        duration: (sample.duration * 1_000_000) / timescale,
        data: sample.data,
      });
      decoder.decode(chunk);
      if (decoder.decodeQueueSize > 10) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (decoder.decodeQueueSize <= 4) {
              resolve();
            } else {
              setTimeout(check, 20);
            }
          };
          check();
        });
      }
    }

    await decoder.flush();
    decoder.close();
    if (decoderError) {
      throw decoderError;
    }

    if (frameIndex === 0) {
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
  }
};
