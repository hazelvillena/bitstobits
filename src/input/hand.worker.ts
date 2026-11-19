/// <reference lib="webworker" />
// Hand landmark detection off the main thread.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let landmarker: HandLandmarker | null = null;

async function init(origin: string) {
  const fileset = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`, true);
  const opts = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    return 'GPU';
  } catch {
    landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
    return 'CPU';
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      const delegate = await init(msg.origin);
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }
  if (msg.type === 'frame') {
    const bitmap = msg.bitmap as ImageBitmap;
    if (!landmarker) {
      bitmap.close();
      return;
    }
    const res = landmarker.detectForVideo(bitmap, msg.t);
    bitmap.close();
    // Pack: per hand 21 × (x, y, z) + handedness flag.
    const hands = res.landmarks.map((lm, i) => {
      const arr = new Float32Array(63);
      for (let j = 0; j < 21; j++) {
        arr[j * 3] = lm[j].x;
        arr[j * 3 + 1] = lm[j].y;
        arr[j * 3 + 2] = lm[j].z;
      }
      const label = res.handedness[i]?.[0]?.categoryName ?? 'Right';
      // Thumb to index tip in metres, from the 3D world landmarks: unlike the
      // on-screen distance it does not shrink when the hand turns or points.
      const w = res.worldLandmarks[i];
      const pinch = w ? Math.hypot(w[4].x - w[8].x, w[4].y - w[8].y, w[4].z - w[8].z) : 1;
      // Palm width (index knuckle to little-finger knuckle), to make the pinch hand-size independent.
      const palm = w ? Math.hypot(w[5].x - w[17].x, w[5].y - w[17].y, w[5].z - w[17].z) : 0.08;
      return { lm: arr, right: label === 'Right', pinch, palm };
    });
    self.postMessage({ type: 'result', hands, t: msg.t }, { transfer: hands.map((h) => h.lm.buffer) });
  }
};
