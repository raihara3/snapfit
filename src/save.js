// Saving captures to the device: blob download, plus Web Share on
// mobile browsers so photos can go straight to the photo library.

export function canvasToBlob(canvas, mimeType, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode the image.'));
    }, mimeType, quality);
  });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareBlob(blob, fileName) {
  if (!navigator.canShare) return false;
  const file = new File([blob], fileName, { type: blob.type });
  return navigator.canShare({ files: [file] });
}

export async function shareBlob(blob, fileName) {
  const file = new File([blob], fileName, { type: blob.type });
  await navigator.share({ files: [file] });
}

export function buildFileName(prefix, extension, date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${prefix}-${stamp}.${extension}`;
}
