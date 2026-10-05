import type { FaceDetector } from "@mediapipe/tasks-vision";

let detectorPromise: Promise<FaceDetector> | null = null;

export const getFaceDetector = () => {
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
};

const detectFaceInBlob = async (blob: Blob): Promise<boolean> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const detector = await getFaceDetector();
    return detector.detect(bitmap).detections.length > 0;
  } finally {
    bitmap.close();
  }
};

export const shouldBlurForFaces = async (blob: Blob): Promise<boolean> => {
  try {
    return await detectFaceInBlob(blob);
  } catch {
    // 一度きりのチェックが失敗した場合、誤って顔を露出させないようにする
    return true;
  }
};
