// Video recording of the filtered canvas via MediaRecorder,
// with microphone audio when the user grants it.

const MIME_TYPE_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export class CanvasRecorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.recorder = null;
    this.audioStream = null;
    this.chunks = [];
  }

  static isSupported() {
    return typeof MediaRecorder !== 'undefined'
      && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get recording() {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  async start() {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.audioStream = null;
    }
    try {
      const canvasStream = this.canvas.captureStream(30);
      const tracks = [
        ...canvasStream.getVideoTracks(),
        ...(this.audioStream ? this.audioStream.getAudioTracks() : []),
      ];
      const mimeType = pickSupportedMimeType();
      this.chunks = [];
      this.recorder = new MediaRecorder(new MediaStream(tracks), {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 12_000_000,
      });
      this.recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      this.recorder.addEventListener('error', () => {
        this.releaseAudio();
        this.recorder = null;
        this.chunks = [];
      });
      this.recorder.start(1000);
    } catch (error) {
      this.releaseAudio();
      this.recorder = null;
      throw error;
    }
  }

  stop() {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === 'inactive') {
        this.releaseAudio();
        this.recorder = null;
        reject(new Error('Recorder is not running.'));
        return;
      }
      recorder.addEventListener('stop', () => {
        const mimeType = recorder.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        this.releaseAudio();
        this.recorder = null;
        resolve({ blob, extension });
      }, { once: true });
      recorder.stop();
    });
  }

  releaseAudio() {
    if (this.audioStream) {
      for (const track of this.audioStream.getTracks()) {
        track.stop();
      }
      this.audioStream = null;
    }
  }
}
