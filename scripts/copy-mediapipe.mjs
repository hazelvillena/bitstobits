// Copies the MediaPipe wasm runtime into /public so it is served locally (no CDN at runtime).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dst = 'public/mediapipe/wasm';
if (!existsSync(src)) process.exit(0);
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
