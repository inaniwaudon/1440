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
