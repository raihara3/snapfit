import { inject } from '@vercel/analytics';

import { CameraManager, describeCameraError } from './camera.js';
import { COLLAGE_LAYOUTS, composeCollage, getCollageLayout, shrinkToCellSize } from './collage.js';
import { PhotoEditor } from './editor.js';
import { FILTERS } from './filters.js';
import { FRAMES, applyFrame } from './frames.js';
import { CanvasRecorder } from './recorder.js';
import { Renderer } from './renderer.js';
import {
  buildFileName,
  canShareBlob,
  canvasToBlob,
  downloadBlob,
  shareBlob,
} from './save.js';

const VIEWFINDER_ASPECT = 3 / 4;
const MAX_ZOOM = 8;
// Recorded chunks are held in memory (~90MB/min at 12Mbps), so cap duration.
const MAX_RECORDING_SECONDS = 600;

const elements = {
  startOverlay: document.getElementById('start-overlay'),
  startButton: document.getElementById('start-button'),
  startError: document.getElementById('start-error'),
  topBar: document.getElementById('top-bar'),
  viewfinder: document.getElementById('viewfinder'),
  controls: document.getElementById('controls'),
  canvas: document.getElementById('preview-canvas'),
  video: document.getElementById('camera-video'),
  flipButton: document.getElementById('flip-button'),
  frameButton: document.getElementById('frame-button'),
  zoomPill: document.getElementById('zoom-pill'),
  flashOverlay: document.getElementById('flash-overlay'),
  collageProgress: document.getElementById('collage-progress'),
  recordIndicator: document.getElementById('record-indicator'),
  recordTime: document.getElementById('record-time'),
  lensRow: document.getElementById('lens-row'),
  filterRow: document.getElementById('filter-row'),
  modeRow: document.getElementById('mode-row'),
  shutterButton: document.getElementById('shutter-button'),
  thumbButton: document.getElementById('thumb-button'),
  thumbImage: document.getElementById('thumb-image'),
  thumbPlaceholder: document.getElementById('thumb-placeholder'),
  layoutButton: document.getElementById('layout-button'),
  layoutPlaceholder: document.getElementById('layout-placeholder'),
  previewOverlay: document.getElementById('preview-overlay'),
  previewImage: document.getElementById('preview-image'),
  previewVideo: document.getElementById('preview-video'),
  previewClose: document.getElementById('preview-close'),
  previewShare: document.getElementById('preview-share'),
  previewSave: document.getElementById('preview-save'),
  importButton: document.getElementById('import-button'),
  importInput: document.getElementById('import-input'),
  editorOverlay: document.getElementById('editor-overlay'),
  editorCanvas: document.getElementById('editor-canvas'),
  editorFilterRow: document.getElementById('editor-filter-row'),
  editorFrameRow: document.getElementById('editor-frame-row'),
  editorClose: document.getElementById('editor-close'),
  editorSave: document.getElementById('editor-save'),
  editorShare: document.getElementById('editor-share'),
  frameSheet: document.getElementById('frame-sheet'),
  frameOptions: document.getElementById('frame-options'),
  layoutSheet: document.getElementById('layout-sheet'),
  layoutOptions: document.getElementById('layout-options'),
  sheetBackdrop: document.getElementById('sheet-backdrop'),
  toast: document.getElementById('toast'),
};

inject();

const camera = new CameraManager(elements.video);
let renderer = null;
let recorder = null;

const state = {
  started: false,
  mode: 'photo',
  filterId: 'normal',
  frameId: 'none',
  layoutId: 'grid',
  lensId: 'wide',
  lensBaseMultiplier: 1,
  zoom: 1,
  busy: false,
  collageShots: [],
  lastCapture: null,
  recordTimer: null,
  recordStartedAt: 0,
};

// ---- Boot ----

elements.startButton.addEventListener('click', async () => {
  elements.startButton.disabled = true;
  elements.startError.hidden = true;
  try {
    await camera.start({ facing: 'environment' });
    renderer = new Renderer(elements.canvas, elements.video);
    recorder = new CanvasRecorder(elements.canvas);
    state.started = true;
    elements.startOverlay.hidden = true;
    elements.topBar.hidden = false;
    elements.viewfinder.hidden = false;
    elements.controls.hidden = false;
    layoutViewfinder();
    renderer.start();
    buildFilterChips();
    buildSheetOptions();
    await buildLensChips();
    applyModeUi();
    updateZoomPill();
  } catch (error) {
    camera.stop();
    elements.startError.textContent = error instanceof DOMException
      ? describeCameraError(error)
      : 'このブラウザでは動作に必要なWebGLが利用できません。';
    elements.startError.hidden = false;
    elements.startButton.disabled = false;
  }
});

function layoutViewfinder() {
  const box = elements.viewfinder.getBoundingClientRect();
  const width = Math.min(box.width, box.height * VIEWFINDER_ASPECT);
  const height = width / VIEWFINDER_ASPECT;
  renderer.setDisplaySize(Math.floor(width), Math.floor(height));
}

new ResizeObserver(() => {
  // Resizing the canvas mid-recording changes the captureStream frame size,
  // which corrupts the output in some muxers.
  if (state.started && !recorder?.recording) layoutViewfinder();
}).observe(elements.viewfinder);

document.addEventListener('visibilitychange', async () => {
  if (!state.started) return;
  if (document.visibilityState === 'hidden') {
    // The render loop pauses in the background, so keeping the recorder
    // (and microphone) running would only capture a frozen frame.
    if (recorder?.recording) {
      await stopRecordingAndPreview().catch(() => stopRecordingUi());
    }
    return;
  }
  const [track] = camera.stream?.getVideoTracks() ?? [];
  if (!track || track.readyState === 'ended') {
    try {
      await selectLens(state.lensId);
    } catch {
      showToast('カメラの再開に失敗しました');
    }
  } else {
    elements.video.play().catch(() => {});
  }
});

// ---- Lens selection ----

async function buildLensChips() {
  const options = [];
  if (!camera.isFront()) {
    const lenses = await camera.listBackLenses();
    const hasUltraWide = lenses.some((lens) => lens.kind === 'ultrawide');
    if (hasUltraWide) options.push({ id: 'ultrawide', label: '.5×' });
    options.push({ id: 'wide', label: '1×' });
    options.push({ id: 'tele', label: '2×' });
  } else {
    options.push({ id: 'wide', label: '1×' });
  }
  options.push({ id: 'fisheye', label: '魚眼' });

  elements.lensRow.replaceChildren(
    ...options.map((option) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'lens-chip';
      chip.textContent = option.label;
      chip.dataset.lens = option.id;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(option.id === state.lensId));
      chip.addEventListener('click', () => {
        selectLens(option.id).catch(async () => {
          showToast('レンズを切り替えられませんでした');
          await recoverCamera();
        });
      });
      return chip;
    }),
  );
}

async function selectLens(lensId) {
  if (recorder?.recording) {
    showToast('録画中はレンズを変更できません');
    return;
  }
  state.lensId = lensId;
  state.zoom = 1;
  state.lensBaseMultiplier = 1;
  renderer.setFisheye(lensId === 'fisheye');

  if (!camera.isFront()) {
    if (lensId === 'ultrawide') {
      const lens = await camera.findLens('ultrawide');
      if (lens) {
        await camera.start({ facing: 'environment', deviceId: lens.deviceId });
        state.lensBaseMultiplier = 0.5;
      }
    } else if (lensId === 'tele') {
      const lens = await camera.findLens('tele');
      if (lens) {
        await camera.start({ facing: 'environment', deviceId: lens.deviceId });
        state.lensBaseMultiplier = 2;
      } else {
        // No telephoto hardware: fall back to 2x digital zoom on the wide lens.
        await camera.start({ facing: 'environment' });
        state.zoom = 2;
      }
    } else if (camera.currentDeviceId && (await camera.findLens('wide'))?.deviceId !== camera.currentDeviceId) {
      await camera.start({ facing: 'environment' });
    }
  }

  renderer.setZoom(state.zoom);
  renderer.setMirror(camera.isFront());
  updateZoomPill();
  for (const chip of elements.lensRow.querySelectorAll('.lens-chip')) {
    chip.setAttribute('aria-selected', String(chip.dataset.lens === lensId));
  }
}

elements.flipButton.addEventListener('click', async () => {
  if (recorder?.recording) {
    showToast('録画中はカメラを切り替えられません');
    return;
  }
  try {
    await camera.flip();
    state.lensId = 'wide';
    state.zoom = 1;
    state.lensBaseMultiplier = 1;
    renderer.setFisheye(false);
    renderer.setZoom(1);
    renderer.setMirror(camera.isFront());
    await buildLensChips();
    updateZoomPill();
  } catch (error) {
    showToast(describeCameraError(error));
    await recoverCamera();
  }
});

async function recoverCamera() {
  try {
    await camera.start({ facing: camera.facing });
    renderer.setMirror(camera.isFront());
  } catch {
    // Leave the frozen viewfinder; the visibilitychange handler retries later.
  }
}

// ---- Zoom (pinch / wheel) ----

function updateZoomPill() {
  const effectiveZoom = state.lensBaseMultiplier * state.zoom;
  elements.zoomPill.textContent = `${effectiveZoom.toFixed(1)}×`;
}

function setZoom(zoom) {
  state.zoom = Math.min(Math.max(zoom, 1), MAX_ZOOM);
  renderer.setZoom(state.zoom);
  updateZoomPill();
}

let pinchStartDistance = 0;
let pinchStartZoom = 1;
let pinching = false;
let swipeStartX = 0;
let swipeStartY = 0;

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

elements.canvas.addEventListener('touchstart', (event) => {
  if (event.touches.length === 2) {
    pinching = true;
    pinchStartDistance = touchDistance(event.touches);
    pinchStartZoom = state.zoom;
  } else if (event.touches.length === 1) {
    swipeStartX = event.touches[0].clientX;
    swipeStartY = event.touches[0].clientY;
  }
}, { passive: true });

elements.canvas.addEventListener('touchmove', (event) => {
  if (pinching && event.touches.length === 2) {
    event.preventDefault();
    setZoom(pinchStartZoom * (touchDistance(event.touches) / pinchStartDistance));
  }
}, { passive: false });

elements.canvas.addEventListener('touchend', (event) => {
  if (pinching) {
    if (event.touches.length === 0) pinching = false;
    return;
  }
  if (event.changedTouches.length !== 1) return;
  const deltaX = event.changedTouches[0].clientX - swipeStartX;
  const deltaY = event.changedTouches[0].clientY - swipeStartY;
  if (Math.abs(deltaX) > 56 && Math.abs(deltaY) < 48) {
    stepFilter(deltaX < 0 ? 1 : -1);
  }
});

elements.canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  setZoom(state.zoom * (event.deltaY < 0 ? 1.06 : 0.94));
}, { passive: false });

// ---- Filters ----

function buildFilterChips() {
  elements.filterRow.replaceChildren(
    ...FILTERS.map((filter) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'filter-chip';
      chip.textContent = filter.label;
      chip.dataset.filter = filter.id;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(filter.id === state.filterId));
      chip.addEventListener('click', () => selectFilter(filter.id));
      return chip;
    }),
  );
}

function selectFilter(filterId) {
  state.filterId = filterId;
  renderer.setFilter(filterId);
  for (const chip of elements.filterRow.querySelectorAll('.filter-chip')) {
    const selected = chip.dataset.filter === filterId;
    chip.setAttribute('aria-selected', String(selected));
    if (selected) chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function stepFilter(direction) {
  const index = FILTERS.findIndex((filter) => filter.id === state.filterId);
  const nextIndex = (index + direction + FILTERS.length) % FILTERS.length;
  selectFilter(FILTERS[nextIndex].id);
}

// ---- Frame & layout sheets ----

function buildSheetOptions() {
  buildOptions(elements.frameOptions, FRAMES, () => state.frameId, (frameId) => {
    state.frameId = frameId;
    elements.frameButton.classList.toggle('active', frameId !== 'none');
    closeSheets();
  });
  buildOptions(elements.layoutOptions, COLLAGE_LAYOUTS, () => state.layoutId, (layoutId) => {
    state.layoutId = layoutId;
    resetCollage();
    closeSheets();
  });
}

function buildOptions(container, items, getSelectedId, onSelect) {
  container.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'sheet-option';
      option.textContent = item.label;
      option.dataset.id = item.id;
      option.setAttribute('aria-selected', String(item.id === getSelectedId()));
      option.addEventListener('click', () => {
        onSelect(item.id);
        for (const sibling of container.children) {
          sibling.setAttribute('aria-selected', String(sibling.dataset.id === item.id));
        }
      });
      return option;
    }),
  );
}

function openSheet(sheet) {
  closeSheets();
  sheet.hidden = false;
  elements.sheetBackdrop.hidden = false;
}

function closeSheets() {
  elements.frameSheet.hidden = true;
  elements.layoutSheet.hidden = true;
  elements.sheetBackdrop.hidden = true;
}

elements.frameButton.addEventListener('click', () => {
  if (state.mode === 'video') {
    showToast('フレームは写真・連写で使えます');
    return;
  }
  openSheet(elements.frameSheet);
});
elements.layoutButton.addEventListener('click', () => openSheet(elements.layoutSheet));
elements.sheetBackdrop.addEventListener('click', closeSheets);

// ---- Modes ----

elements.modeRow.addEventListener('click', (event) => {
  const chip = event.target.closest('.mode-chip');
  if (!chip || chip.dataset.mode === state.mode) return;
  if (recorder?.recording) {
    showToast('録画中はモードを変更できません');
    return;
  }
  state.mode = chip.dataset.mode;
  resetCollage();
  applyModeUi();
});

function applyModeUi() {
  for (const chip of elements.modeRow.querySelectorAll('.mode-chip')) {
    chip.setAttribute('aria-selected', String(chip.dataset.mode === state.mode));
  }
  const isCollage = state.mode === 'collage';
  const isVideo = state.mode === 'video';
  elements.shutterButton.classList.toggle('video', isVideo);
  elements.layoutButton.hidden = !isCollage;
  elements.layoutPlaceholder.hidden = isCollage;
  elements.frameButton.style.opacity = isVideo ? '0.4' : '1';
}

function resetCollage() {
  state.collageShots = [];
  elements.collageProgress.hidden = true;
}

// ---- Capture ----

elements.shutterButton.addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  try {
    if (state.mode === 'photo') {
      await capturePhoto();
    } else if (state.mode === 'collage') {
      await captureCollageShot();
    } else {
      await toggleRecording();
    }
  } catch (error) {
    console.error(error);
    showToast('撮影に失敗しました');
  } finally {
    state.busy = false;
  }
});

function blinkFlash() {
  elements.flashOverlay.classList.remove('blink');
  // Force a reflow so the animation restarts on consecutive shots.
  void elements.flashOverlay.offsetWidth;
  elements.flashOverlay.classList.add('blink');
}

async function capturePhoto() {
  blinkFlash();
  const still = renderer.captureStill();
  await finishPhoto(still);
}

async function captureCollageShot() {
  blinkFlash();
  const layout = getCollageLayout(state.layoutId);
  state.collageShots.push(shrinkToCellSize(renderer.captureStill()));
  if (state.collageShots.length < layout.count) {
    elements.collageProgress.textContent = `${state.collageShots.length} / ${layout.count}`;
    elements.collageProgress.hidden = false;
    return;
  }
  const composite = composeCollage(state.collageShots, state.layoutId);
  resetCollage();
  await finishPhoto(composite);
}

async function finishPhoto(photoCanvas) {
  const framed = applyFrame(photoCanvas, state.frameId);
  const blob = await canvasToBlob(framed.canvas, framed.mimeType);
  const fileName = buildFileName('snapfit', framed.extension);
  setLastCapture({ blob, fileName, isVideo: false, thumbnailSource: framed.canvas });
  openPreview();
}

async function toggleRecording() {
  if (!CanvasRecorder.isSupported()) {
    showToast('このブラウザは録画に対応していません');
    return;
  }
  if (recorder.recording) {
    await stopRecordingAndPreview();
  } else {
    try {
      await recorder.start();
      startRecordingUi();
    } catch {
      showToast('録画を開始できませんでした');
    }
  }
}

async function stopRecordingAndPreview() {
  try {
    const { blob, extension } = await recorder.stop();
    stopRecordingUi();
    const fileName = buildFileName('snapfit', extension);
    setLastCapture({ blob, fileName, isVideo: true, thumbnailSource: renderer.captureStill() });
    openPreview();
  } catch (error) {
    stopRecordingUi();
    throw error;
  }
}

function startRecordingUi() {
  state.recordStartedAt = Date.now();
  elements.shutterButton.classList.add('recording');
  elements.recordIndicator.hidden = false;
  elements.recordTime.textContent = '0:00';
  state.recordTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.recordStartedAt) / 1000);
    if (seconds >= MAX_RECORDING_SECONDS) {
      stopRecordingAndPreview().catch(() => {});
      return;
    }
    const minutes = Math.floor(seconds / 60);
    elements.recordTime.textContent = `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }, 500);
}

function stopRecordingUi() {
  clearInterval(state.recordTimer);
  state.recordTimer = null;
  elements.shutterButton.classList.remove('recording');
  elements.recordIndicator.hidden = true;
}

// ---- Last capture / preview / save ----

function setLastCapture({ blob, fileName, isVideo, thumbnailSource }) {
  if (state.lastCapture) URL.revokeObjectURL(state.lastCapture.url);
  state.lastCapture = { blob, fileName, isVideo, url: URL.createObjectURL(blob) };
  elements.thumbImage.src = makeThumbnail(thumbnailSource);
  elements.thumbButton.hidden = false;
  elements.thumbPlaceholder.hidden = true;
}

function makeThumbnail(sourceCanvas) {
  const size = 128;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = size;
  thumbCanvas.height = size;
  const context = thumbCanvas.getContext('2d');
  const crop = Math.min(sourceCanvas.width, sourceCanvas.height);
  context.drawImage(
    sourceCanvas,
    (sourceCanvas.width - crop) / 2,
    (sourceCanvas.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    size,
    size,
  );
  return thumbCanvas.toDataURL('image/jpeg', 0.7);
}

function openPreview() {
  const capture = state.lastCapture;
  if (!capture) return;
  elements.previewImage.hidden = capture.isVideo;
  elements.previewVideo.hidden = !capture.isVideo;
  if (capture.isVideo) {
    elements.previewVideo.src = capture.url;
  } else {
    elements.previewImage.src = capture.url;
  }
  elements.previewShare.hidden = !canShareBlob(capture.blob, capture.fileName);
  elements.previewOverlay.hidden = false;
}

elements.thumbButton.addEventListener('click', openPreview);

elements.previewClose.addEventListener('click', () => {
  elements.previewVideo.pause();
  elements.previewVideo.removeAttribute('src');
  // Without load(), iOS Safari can keep the decoder and buffers alive.
  elements.previewVideo.load();
  elements.previewOverlay.hidden = true;
});

elements.previewSave.addEventListener('click', () => {
  const capture = state.lastCapture;
  if (!capture) return;
  downloadBlob(capture.blob, capture.fileName);
  showToast('保存しました');
});

elements.previewShare.addEventListener('click', async () => {
  const capture = state.lastCapture;
  if (!capture) return;
  try {
    await shareBlob(capture.blob, capture.fileName);
  } catch (error) {
    if (error.name !== 'AbortError') showToast('共有に失敗しました');
  }
});

// ---- Photo import editor ----

const photoEditor = new PhotoEditor({
  overlay: elements.editorOverlay,
  canvas: elements.editorCanvas,
  filterRow: elements.editorFilterRow,
  frameRow: elements.editorFrameRow,
  close: elements.editorClose,
  save: elements.editorSave,
  share: elements.editorShare,
}, { onToast: showToast });

elements.importButton.addEventListener('click', () => {
  if (recorder?.recording) {
    showToast('録画中は編集できません');
    return;
  }
  elements.importInput.click();
});

elements.importInput.addEventListener('change', async () => {
  const [file] = elements.importInput.files;
  elements.importInput.value = '';
  if (!file) return;
  try {
    await photoEditor.open(file);
  } catch {
    showToast('画像を読み込めませんでした');
  }
});

// ---- Toast ----

let toastTimer = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2200);
}
