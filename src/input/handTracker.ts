import { HandFilter, readPose, PoseDebounce, type Calibration, type HandFrame, DEFAULT_CAL } from './handModel';

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
  private filters = new Map<string, { f: HandFilter; d: PoseDebounce; seen: number }>();
  private lastT = 0;

  constructor(private video: HTMLVideoElement) {
    try {
      const saved = localStorage.getItem('b2b.calibration');
      if (saved) this.cal = { ...DEFAULT_CAL, ...JSON.parse(saved) };
    } catch { /* storage unavailable */ }
  }

  async start() {
    this.onStatus('Opening camera');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.cal.aspect = this.video.videoWidth / this.video.videoHeight || 4 / 3;

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
      localStorage.setItem('b2b.calibration', JSON.stringify(this.cal));
    } catch { /* ignore */ }
  }

  private pump = async () => {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void };
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(this.pump) : requestAnimationFrame(this.pump));
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

  private onResult(data: { type: string; hands: { lm: Float32Array; right: boolean }[]; t: number }) {
    if (data.type !== 'result') return;
    this.busy = false;
    const dt = this.lastT ? Math.max(1 / 120, (data.t - this.lastT) / 1000) : 1 / 30;
    this.lastT = data.t;
    const out: HandFrame[] = [];
    const now = performance.now();
    for (const h of data.hands) {
      const key = h.right ? 'R' : 'L';
      let slot = this.filters.get(key);
      if (!slot || now - slot.seen > 400) {
        slot = { f: new HandFilter(), d: new PoseDebounce(3), seen: now };
        this.filters.set(key, slot);
      }
      slot.seen = now;
      const lm = slot.f.apply(h.lm, dt);
      const r = readPose(lm, this.cal);
      out.push({ lm, right: h.right, pose: slot.d.push(r.pose), span: r.span, pinchRatio: r.pinchRatio });
    }
    this.hands = out;
  }
}
