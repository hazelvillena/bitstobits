import { bend, HandFilter, readPose, PoseDebounce, type Calibration, type HandFrame, DEFAULT_CAL } from './handModel';

/**
 * Camera → worker → filtered hand frames.
 * Backpressure: a new frame is sent only after the previous result returns,
 * so detection never queues up behind rendering.
 */
export class HandTracker {
  hands: HandFrame[] = [];
  cal: Calibration = { ...DEFAULT_CAL };
  ready = false;
  delegate = '';
  onStatus: (s: string) => void = () => {};

  private worker: Worker | null = null;
  private busy = false;
  private filters = new Map<string, { f: HandFilter; d: PoseDebounce; seen: number; pinch: number }>();
  private lastT = 0;

  constructor(private video: HTMLVideoElement) {
    try {
      const saved = localStorage.getItem('b2b.calibration.v2');
      if (saved) {
        this.cal = { ...DEFAULT_CAL, ...JSON.parse(saved) };
        this.calibrated = true;
      }
    } catch { /* storage unavailable */ }
  }

  /** Whether this browser has a saved calibration. */
  calibrated = false;
  private stream: MediaStream | null = null;

  /** Turn the camera off and stop detecting (mouse mode). */
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ready = false;
    this.hands = [];
  }

  async start() {
    if (this.ready) return;
    this.onStatus('Opening camera');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.cal.aspect = this.video.videoWidth / this.video.videoHeight || 4 / 3;

    if (this.worker) {
      // Already loaded once: just resume.
      this.ready = true;
      this.onStatus('');
      this.pump();
      return;
    }
    this.onStatus('Loading hand model');
    this.worker = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e) => {
        if (e.data.type === 'ready') {
          this.delegate = e.data.delegate;
          resolve();
        } else if (e.data.type === 'error') reject(new Error(e.data.message));
      };
      this.worker!.postMessage({ type: 'init', origin: location.origin });
    });
    this.worker.onmessage = (e) => this.onResult(e.data);
    this.ready = true;
    this.onStatus('');
    this.pump();
  }

  saveCalibration() {
    try {
      localStorage.setItem('b2b.calibration.v2', JSON.stringify(this.cal));
      this.calibrated = true;
    } catch { /* ignore */ }
  }

  private pump = async () => {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void };
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(this.pump) : requestAnimationFrame(this.pump));
    if (!this.ready) return;
    if (!this.busy && this.worker && v.readyState >= 2) {
      this.busy = true;
      try {
        const bitmap = await createImageBitmap(v);
        this.worker.postMessage({ type: 'frame', bitmap, t: performance.now() }, [bitmap]);
      } catch {
        this.busy = false;
      }
    }
    next();
  };

  private onResult(data: { type: string; hands: { lm: Float32Array; right: boolean; pinch: number; palm: number }[]; t: number }) {
    if (data.type !== 'result') return;
    this.busy = false;
    const dt = this.lastT ? Math.max(1 / 120, (data.t - this.lastT) / 1000) : 1 / 30;
    this.lastT = data.t;
    const out: HandFrame[] = [];
    const now = performance.now();
    // Two hands need two identities. The classifier sometimes labels both
    // hands the same; then fall back to which side of the image each is on.
    if (data.hands.length === 2 && data.hands[0].right === data.hands[1].right) {
      const [a, b] = data.hands;
      const aLeftInImage = a.lm[0] < b.lm[0]; // image x of the wrist
      a.right = aLeftInImage; // camera image is unmirrored: image-left is the person's right
      b.right = !aLeftInImage;
    }
    for (const h of data.hands) {
      const key = h.right ? 'R' : 'L';
      let slot = this.filters.get(key);
      if (!slot || now - slot.seen > 400) {
        slot = { f: new HandFilter(), d: new PoseDebounce(3), seen: now, pinch: h.pinch };
        this.filters.set(key, slot);
      }
      slot.seen = now;
      const lm = slot.f.apply(h.lm, dt);
      const r = readPose(lm, this.cal);
      slot.pinch += (h.pinch - slot.pinch) * 0.6; // light smoothing; hysteresis does the rest
      const rel = slot.pinch / Math.max(0.04, h.palm);
      const indexBend = bend(lm, [5, 6, 7, 8], this.cal.aspect);
      out.push({ lm, right: h.right, pose: slot.d.push(r.pose), span: r.span, pinchRatio: r.pinchRatio, pinchDist: slot.pinch, pinchRel: rel, indexBend });
    }
    this.hands = out;
  }
}
