// Multi-shot collage compositing: sequential captures merged into one image.

export const COLLAGE_LAYOUTS = [
  { id: 'pair', label: '2枚（横並び）', count: 2, columns: 2, rows: 1 },
  { id: 'strip', label: '3枚（縦ストリップ）', count: 3, columns: 1, rows: 3 },
  { id: 'grid', label: '4枚（グリッド）', count: 4, columns: 2, rows: 2 },
];

export function getCollageLayout(layoutId) {
  return COLLAGE_LAYOUTS.find((layout) => layout.id === layoutId) ?? COLLAGE_LAYOUTS[0];
}

const MAX_CELL_WIDTH = 2048;

// Shots are held in memory until the collage is composed; shrinking each one
// to the final cell size keeps peak canvas memory low on iOS Safari.
export function shrinkToCellSize(shotCanvas) {
  if (shotCanvas.width <= MAX_CELL_WIDTH) return shotCanvas;
  const scale = MAX_CELL_WIDTH / shotCanvas.width;
  const shrunk = document.createElement('canvas');
  shrunk.width = MAX_CELL_WIDTH;
  shrunk.height = Math.round(shotCanvas.height * scale);
  shrunk.getContext('2d').drawImage(shotCanvas, 0, 0, shrunk.width, shrunk.height);
  return shrunk;
}

export function composeCollage(shotCanvases, layoutId) {
  const layout = getCollageLayout(layoutId);
  const cellWidth = Math.min(
    MAX_CELL_WIDTH,
    ...shotCanvases.map((shot) => shot.width),
  );
  const cellAspect = shotCanvases[0].width / shotCanvases[0].height;
  const cellHeight = Math.round(cellWidth / cellAspect);

  const isStrip = layout.id === 'strip';
  const gap = Math.round(cellWidth * (isStrip ? 0.045 : 0.03));
  const canvas = document.createElement('canvas');
  canvas.width = layout.columns * cellWidth + (layout.columns + 1) * gap;
  canvas.height = layout.rows * cellHeight + (layout.rows + 1) * gap;
  const context = canvas.getContext('2d');
  context.fillStyle = isStrip ? '#141210' : '#fbfbf8';
  context.fillRect(0, 0, canvas.width, canvas.height);

  shotCanvases.forEach((shot, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x = gap + column * (cellWidth + gap);
    const y = gap + row * (cellHeight + gap);
    drawCoverCell(context, shot, x, y, cellWidth, cellHeight);
  });
  return canvas;
}

function drawCoverCell(context, source, x, y, width, height) {
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
