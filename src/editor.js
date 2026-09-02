// Editing existing photos: decode a picked image file and run it through
// the same WebGL filter pipeline and frame compositors as the live camera.

import { FILTERS } from './filters.js';
import { FRAMES, applyFrame } from './frames.js';
import { Renderer } from './renderer.js';
import {
  buildFileName,
  canvasToBlob,
  downloadBlob,
  shareBlob,
} from './save.js';

const SOURCE_MAX_DIMENSION = 4096;
const PREVIEW_MAX_DIMENSION = 1600;

// Decoding through a 2D canvas applies EXIF orientation consistently and
// caps the texture size for mobile GPUs.
async function decodeToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Failed to decode the image.'));
      element.src = url;
    });
    const scale = Math.min(
      1,
      SOURCE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class PhotoEditor {
  constructor(elements, { onToast }) {
    this.elements = elements;
    this.onToast = onToast;
    this.renderer = null;
    this.filterId = 'normal';
    this.frameId = 'none';
    this.busy = false;
    this.buildChips();
    elements.close.addEventListener('click', () => this.close());
    elements.save.addEventListener('click', () => this.export('save'));
    elements.share.addEventListener('click', () => this.export('share'));
  }

  async open(file) {
    const source = await decodeToCanvas(file);
    if (!this.renderer) {
      this.renderer = new Renderer(document.createElement('canvas'), source);
    } else {
      this.renderer.setSource(source);
    }
    // The render canvas aspect drives the crop; match the photo so the
    // full image stays visible (no cover-crop, no zoom, no mirror).
    const aspectScale = 512 / Math.max(source.width, source.height);
    this.renderer.canvas.width = Math.max(1, Math.round(source.width * aspectScale));
    this.renderer.canvas.height = Math.max(1, Math.round(source.height * aspectScale));
    this.selectFilter('normal');
    this.selectFrame('none');
    this.elements.share.hidden = typeof navigator.canShare !== 'function';
    this.elements.overlay.hidden = false;
  }

  close() {
    this.elements.overlay.hidden = true;
    // Swap in a tiny placeholder so the decoded photo can be collected.
    this.renderer?.setSource(document.createElement('canvas'));
  }

  buildChips() {
    this.elements.filterRow.replaceChildren(
      ...FILTERS.map((filter) => this.createChip(filter, 'filter', () => this.selectFilter(filter.id))),
    );
    this.elements.frameRow.replaceChildren(
      ...FRAMES.map((frame) => this.createChip(frame, 'frame', () => this.selectFrame(frame.id))),
    );
  }

  createChip(item, group, onSelect) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip';
    chip.textContent = item.label;
    chip.dataset.group = group;
    chip.dataset.id = item.id;
    chip.addEventListener('click', onSelect);
    return chip;
  }

  markSelection(group, selectedId) {
    const row = group === 'filter' ? this.elements.filterRow : this.elements.frameRow;
    for (const chip of row.children) {
      chip.setAttribute('aria-selected', String(chip.dataset.id === selectedId));
    }
  }

  selectFilter(filterId) {
    this.filterId = filterId;
    this.renderer.setFilter(filterId);
    this.markSelection('filter', filterId);
    this.renderPreview();
  }

  selectFrame(frameId) {
    this.frameId = frameId;
    this.markSelection('frame', frameId);
    this.renderPreview();
  }

  renderPreview() {
    const still = this.renderer.captureStill(PREVIEW_MAX_DIMENSION);
    const framed = applyFrame(still, this.frameId);
    const display = this.elements.canvas;
    display.width = framed.canvas.width;
    display.height = framed.canvas.height;
    display.getContext('2d').drawImage(framed.canvas, 0, 0);
  }

  async export(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      const still = this.renderer.captureStill();
      const framed = applyFrame(still, this.frameId);
      const blob = await canvasToBlob(framed.canvas, framed.mimeType);
      const fileName = buildFileName('snapfit-edit', framed.extension);
      if (action === 'share') {
        await shareBlob(blob, fileName);
      } else {
        downloadBlob(blob, fileName);
        this.onToast('保存しました');
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.onToast(action === 'share' ? '共有に失敗しました' : '保存に失敗しました');
      }
    } finally {
      this.busy = false;
    }
  }
}
