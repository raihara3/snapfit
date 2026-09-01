// Camera stream management: high-resolution capture, facing flip,
// and physical lens (ultra-wide / telephoto) selection on multi-camera phones.

const HIGH_RESOLUTION_CONSTRAINTS = {
  width: { ideal: 4096 },
  height: { ideal: 3072 },
  frameRate: { ideal: 30 },
};

const ULTRA_WIDE_PATTERN = /ultra[- ]?wide|超広角|0\.5/i;
const TELEPHOTO_PATTERN = /tele(photo)?|望遠/i;
const FRONT_PATTERN = /front|前面|フロント|facing front|user/i;

export class CameraManager {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.facing = 'environment';
    this.currentDeviceId = null;
  }

  async start({ facing = this.facing, deviceId = null } = {}) {
    this.stop();
    const videoConstraints = { ...HIGH_RESOLUTION_CONSTRAINTS };
    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = facing;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });
    this.facing = facing;
    const [track] = this.stream.getVideoTracks();
    this.currentDeviceId = track.getSettings().deviceId ?? deviceId;
    this.video.srcObject = this.stream;
    await this.video.play();
    await this.waitForDimensions();
    return this.stream;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  async flip() {
    const nextFacing = this.facing === 'environment' ? 'user' : 'environment';
    await this.start({ facing: nextFacing });
    return nextFacing;
  }

  isFront() {
    return this.facing === 'user';
  }

  // Device labels are only populated after permission is granted,
  // so call this after start() has succeeded at least once.
  async listBackLenses() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const lenses = [];
    for (const device of devices) {
      if (device.kind !== 'videoinput') continue;
      if (FRONT_PATTERN.test(device.label)) continue;
      let kind = 'wide';
      if (ULTRA_WIDE_PATTERN.test(device.label)) kind = 'ultrawide';
      else if (TELEPHOTO_PATTERN.test(device.label)) kind = 'tele';
      lenses.push({ deviceId: device.deviceId, label: device.label, kind });
    }
    return lenses;
  }

  async findLens(kind) {
    const lenses = await this.listBackLenses();
    return lenses.find((lens) => lens.kind === kind) ?? null;
  }

  waitForDimensions() {
    if (this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        this.video.removeEventListener('loadedmetadata', finish);
        resolve();
      };
      const timeout = setTimeout(finish, 5000);
      this.video.addEventListener('loadedmetadata', finish);
    });
  }
}

export function describeCameraError(error) {
  switch (error.name) {
    case 'NotAllowedError':
      return 'カメラへのアクセスが許可されていません。ブラウザの設定からカメラを許可して、再読み込みしてください。';
    case 'NotFoundError':
      return '利用できるカメラが見つかりませんでした。';
    case 'NotReadableError':
      return 'カメラを起動できませんでした。他のアプリがカメラを使用していないか確認してください。';
    default:
      return `カメラの起動に失敗しました（${error.name ?? error.message}）。`;
  }
}
