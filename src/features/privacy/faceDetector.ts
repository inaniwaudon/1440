import type { FaceDetector } from "@mediapipe/tasks-vision";

let detectorPromise: Promise<FaceDetector> | null = null;

export function getFaceDetector() {
  if (!detectorPromise) {
    detectorPromise = import("@mediapipe/tasks-vision").then(
      async ({ FaceDetector, FilesetResolver }) => {
        const base = import.meta.env.BASE_URL;
        const vision = await FilesetResolver.forVisionTasks(
          `${base}mediapipe/wasm`,
        );
        return FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${base}models/blaze_face_short_range.tflite`,
            delegate: "CPU",
          },
          minDetectionConfidence: 0.35,
        });
      },
    );
    detectorPromise.catch(() => {
      detectorPromise = null;
    });
  }

  return detectorPromise;
}

export async function detectFaceInBlob(blob: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(blob);
  try {
    const detector = await getFaceDetector();
    return detector.detect(bitmap).detections.length > 0;
  } finally {
    bitmap.close();
  }
}

export async function shouldBlurForFaces(blob: Blob): Promise<boolean> {
  try {
    return await detectFaceInBlob(blob);
  } catch {
    // A failed one-time check must not expose a face by accident.
    return true;
  }
}
