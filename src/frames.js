// Frame compositors. Each takes a captured photo canvas and returns a new
// canvas with the frame applied. Instax and stamp frames keep a transparent
// outer margin, so they (and the film frame with punched holes) export as PNG.

export const FRAMES = [
  { id: 'none', label: 'なし' },
  { id: 'instax', label: 'チェキ' },
  { id: 'stamp', label: '切手' },
  { id: 'film', label: 'フィルム' },
];

export function applyFrame(photoCanvas, frameId) {
  switch (frameId) {
    case 'instax':
      return { canvas: drawInstaxFrame(photoCanvas), mimeType: 'image/png', extension: 'png' };
    case 'stamp':
      return { canvas: drawStampFrame(photoCanvas), mimeType: 'image/png', extension: 'png' };
    case 'film':
      return { canvas: drawFilmFrame(photoCanvas), mimeType: 'image/png', extension: 'png' };
    default:
      return { canvas: photoCanvas, mimeType: 'image/jpeg', extension: 'jpg' };
  }
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  return canvas;
}

// Draws `source` covering the destination rect, cropping the overflow.
function drawCover(context, source, x, y, width, height) {
  const sourceAspect = source.width / source.height;
  const targetAspect = width / height;
  let cropWidth = source.width;
  let cropHeight = source.height;
  if (sourceAspect > targetAspect) {
    cropWidth = source.height * targetAspect;
  } else {
    cropHeight = source.width / targetAspect;
  }
  const cropX = (source.width - cropWidth) / 2;
  const cropY = (source.height - cropHeight) / 2;
  context.drawImage(source, cropX, cropY, cropWidth, cropHeight, x, y, width, height);
}

function roundedRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

// Instax mini proportions: card 54x86mm, image window 46x62mm,
// 4mm side/top margins and a 20mm bottom margin, drawn at the photo's
// native pixel density with a transparent margin around the card.
function drawInstaxFrame(photoCanvas) {
  const pixelsPerMm = Math.min(Math.max(photoCanvas.width / 46, 8), 44);
  const cardWidth = 54 * pixelsPerMm;
  const cardHeight = 86 * pixelsPerMm;
  const outerMargin = 6 * pixelsPerMm;
  const canvas = createCanvas(cardWidth + outerMargin * 2, cardHeight + outerMargin * 2);
  const context = canvas.getContext('2d');

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.28)';
  context.shadowBlur = 2.4 * pixelsPerMm;
  context.shadowOffsetY = 1.2 * pixelsPerMm;
  roundedRectPath(context, outerMargin, outerMargin, cardWidth, cardHeight, 1.6 * pixelsPerMm);
  context.fillStyle = '#fdfdfa';
  context.fill();
  context.restore();

  const imageX = outerMargin + 4 * pixelsPerMm;
  const imageY = outerMargin + 4 * pixelsPerMm;
  drawCover(context, photoCanvas, imageX, imageY, 46 * pixelsPerMm, 62 * pixelsPerMm);
  context.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  context.lineWidth = Math.max(1, 0.12 * pixelsPerMm);
  context.strokeRect(imageX, imageY, 46 * pixelsPerMm, 62 * pixelsPerMm);
  return canvas;
}

// Postage-stamp frame: white border with perforated (punched-out) edges
// and a transparent outer margin.
function drawStampFrame(photoCanvas) {
  const photoWidth = photoCanvas.width;
  const photoHeight = photoCanvas.height;
  const border = photoWidth * 0.07;
  const holeRadius = photoWidth * 0.028;
  const outerMargin = holeRadius * 2.5;
  const stampWidth = photoWidth + border * 2;
  const stampHeight = photoHeight + border * 2;
  const canvas = createCanvas(stampWidth + outerMargin * 2, stampHeight + outerMargin * 2);
  const context = canvas.getContext('2d');

  context.fillStyle = '#fbfbf8';
  context.fillRect(outerMargin, outerMargin, stampWidth, stampHeight);
  drawCover(context, photoCanvas, outerMargin + border, outerMargin + border, photoWidth, photoHeight);
  context.strokeStyle = 'rgba(0, 0, 0, 0.1)';
  context.lineWidth = Math.max(1, photoWidth * 0.003);
  context.strokeRect(outerMargin + border, outerMargin + border, photoWidth, photoHeight);

  context.globalCompositeOperation = 'destination-out';
  punchEdgeHoles(context, outerMargin, outerMargin, stampWidth, stampHeight, holeRadius);
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

// Punches semicircular perforations centered on the rect's edges,
// including one at each corner.
function punchEdgeHoles(context, x, y, width, height, radius) {
  const spacing = radius * 3;
  const columns = Math.max(2, Math.round(width / spacing));
  const rows = Math.max(2, Math.round(height / spacing));
  for (let i = 0; i <= columns; i++) {
    const holeX = x + (width * i) / columns;
    punchHole(context, holeX, y, radius);
    punchHole(context, holeX, y + height, radius);
  }
  for (let i = 1; i < rows; i++) {
    const holeY = y + (height * i) / rows;
    punchHole(context, x, holeY, radius);
    punchHole(context, x + width, holeY, radius);
  }
}

function punchHole(context, x, y, radius) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

// 35mm film-strip frame: black surround with transparent sprocket holes
// along both sides and edge markings.
function drawFilmFrame(photoCanvas) {
  const photoWidth = photoCanvas.width;
  const photoHeight = photoCanvas.height;
  const sideMargin = photoWidth * 0.13;
  const verticalMargin = photoWidth * 0.06;
  const canvas = createCanvas(photoWidth + sideMargin * 2, photoHeight + verticalMargin * 2);
  const context = canvas.getContext('2d');

  context.fillStyle = '#141210';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(photoCanvas, sideMargin, verticalMargin, photoWidth, photoHeight);

  const holeWidth = photoWidth * 0.055;
  const holeHeight = photoWidth * 0.042;
  const holeSpacing = holeHeight * 2.1;
  const holeRadius = holeWidth * 0.25;
  const leftHoleX = (sideMargin - holeWidth) / 2;
  const rightHoleX = canvas.width - sideMargin + leftHoleX;
  context.globalCompositeOperation = 'destination-out';
  const holeCount = Math.floor((canvas.height - holeSpacing) / holeSpacing);
  const holesStartY = (canvas.height - holeCount * holeSpacing + (holeSpacing - holeHeight)) / 2;
  for (let i = 0; i < holeCount; i++) {
    const holeY = holesStartY + i * holeSpacing;
    roundedRectPath(context, leftHoleX, holeY, holeWidth, holeHeight, holeRadius);
    context.fill();
    roundedRectPath(context, rightHoleX, holeY, holeWidth, holeHeight, holeRadius);
    context.fill();
  }
  context.globalCompositeOperation = 'source-over';

  const fontSize = photoWidth * 0.032;
  context.fillStyle = '#e8892a';
  context.font = `600 ${fontSize}px "Courier New", monospace`;
  context.save();
  context.translate(sideMargin - fontSize * 0.35, verticalMargin + photoHeight * 0.04);
  context.rotate(Math.PI / 2);
  context.fillText('SNAPFIT 400', 0, 0);
  context.restore();
  context.save();
  context.translate(canvas.width - sideMargin + fontSize * 1.3, verticalMargin + photoHeight * 0.82);
  context.rotate(Math.PI / 2);
  context.fillText('▶ 24A', 0, 0);
  context.restore();
  return canvas;
}
