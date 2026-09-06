const assert = require('assert');
const {
  createQuadMapper, validateQuad, validateReferenceQuad,
  detectImageContentBounds, inferGridFromReference, fitGridGeometry,
  robustCellColor, stabilizeNeutralCells, recognizeChart
} = require('../apps/wechat/miniprogram/utils/chartRecognizer');

const quad = [{ x: 10, y: 20 }, { x: 110, y: 10 }, { x: 120, y: 120 }, { x: 0, y: 100 }];
const map = createQuadMapper(quad);
assert.deepStrictEqual(Object.keys(map(.5, .5)).sort(), ['x', 'y']);
assert(validateQuad(quad, 120, 120));
assert(!validateQuad([quad[0], quad[2], quad[1], quad[3]], 120, 120));
assert(validateReferenceQuad([{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 40 }], 120, 120));
assert(!validateReferenceQuad([{ x: 20, y: 20 }, { x: 40, y: 40 }, { x: 40, y: 20 }, { x: 20, y: 40 }], 120, 120));

const redWithText = Array.from({ length: 20 }, () => [220, 50, 60]).concat(Array.from({ length: 5 }, () => [12, 12, 12]));
assert.deepStrictEqual(robustCellColor(redWithText), [220, 50, 60]);
assert.deepStrictEqual(robustCellColor(Array.from({ length: 25 }, () => [18, 20, 22])), [18, 20, 22]);
const h1 = ['H1', 'H1', 253, 251, 255], h2 = ['H2', 'H2', 254, 255, 255];
const neutralNoise = [[h2, h2, h2], [h2, h1, h2], [h2, h2, h2]];
assert.strictEqual(stabilizeNeutralCells(neutralNoise)[1][1][0], 'H2');

const width = 40, height = 40, pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
  const index = (y * width + x) * 4, bright = ((x >= 20) + (y >= 20) * 2) * 60;
  pixels[index] = 30 + bright; pixels[index + 1] = 40 + bright; pixels[index + 2] = 50 + bright; pixels[index + 3] = 255;
}
const result = recognizeChart(pixels, width, height, [{ x: 0, y: 0 }, { x: 39, y: 0 }, { x: 39, y: 39 }, { x: 0, y: 39 }], 4, 4, rgb => rgb.join(','));
assert.strictEqual(result.length, 4);
assert.strictEqual(result[0].length, 4);
assert.notStrictEqual(result[0][0], result[3][3]);

// A 2 × 2 reference in the middle of a chart should recover both outer bounds
// even when the source image contains a blank margin around the grid.
const autoWidth = 150, autoHeight = 120;
const autoPixels = new Uint8ClampedArray(autoWidth * autoHeight * 4);
for (let y = 0; y < autoHeight; y += 1) for (let x = 0; x < autoWidth; x += 1) {
  const index = (y * autoWidth + x) * 4;
  autoPixels[index] = 246; autoPixels[index + 1] = 244; autoPixels[index + 2] = 247; autoPixels[index + 3] = 255;
}
const chartLeft = 30, chartTop = 20, cellSize = 10, autoColumns = 8, autoRows = 7;
for (let row = 0; row < autoRows; row += 1) for (let column = 0; column < autoColumns; column += 1) {
  const shade = 160 + ((row + column) % 3) * 22;
  for (let y = chartTop + row * cellSize + 1; y < chartTop + (row + 1) * cellSize; y += 1) {
    for (let x = chartLeft + column * cellSize + 1; x < chartLeft + (column + 1) * cellSize; x += 1) {
      const index = (y * autoWidth + x) * 4;
      autoPixels[index] = shade; autoPixels[index + 1] = shade - 8; autoPixels[index + 2] = shade - 14;
    }
  }
}
for (let column = 0; column <= autoColumns; column += 1) {
  const x = chartLeft + column * cellSize;
  for (let y = chartTop; y <= chartTop + autoRows * cellSize; y += 1) {
    const index = (y * autoWidth + x) * 4;
    autoPixels[index] = 38; autoPixels[index + 1] = 38; autoPixels[index + 2] = 42;
  }
}
for (let row = 0; row <= autoRows; row += 1) {
  const y = chartTop + row * cellSize;
  for (let x = chartLeft; x <= chartLeft + autoColumns * cellSize; x += 1) {
    const index = (y * autoWidth + x) * 4;
    autoPixels[index] = 38; autoPixels[index + 1] = 38; autoPixels[index + 2] = 42;
  }
}
const reference = [
  { x: chartLeft + 3 * cellSize, y: chartTop + 2 * cellSize },
  { x: chartLeft + 5 * cellSize, y: chartTop + 2 * cellSize },
  { x: chartLeft + 5 * cellSize, y: chartTop + 4 * cellSize },
  { x: chartLeft + 3 * cellSize, y: chartTop + 4 * cellSize }
];
const inferred = inferGridFromReference(autoPixels, autoWidth, autoHeight, reference);
assert.strictEqual(inferred.columns, autoColumns);
assert.strictEqual(inferred.rows, autoRows);
assert(inferred.confidence > .25);
const corrected = fitGridGeometry(inferred, 9, 6);
assert.strictEqual(corrected.columns, 9);
assert.strictEqual(corrected.rows, 6);

// The user's 2 × 2 frame is authoritative. A different, strong image-wide
// periodic pattern must not rescale the selected eight-pixel cells to ten pixels.
const conflictWidth = 160, conflictHeight = 120;
const conflictPixels = new Uint8ClampedArray(conflictWidth * conflictHeight * 4);
for (let y = 0; y < conflictHeight; y += 1) for (let x = 0; x < conflictWidth; x += 1) {
  const index = (y * conflictWidth + x) * 4;
  const line = x % 10 === 0 || y % 10 === 0;
  conflictPixels[index] = conflictPixels[index + 1] = conflictPixels[index + 2] = line ? 18 : 232;
  conflictPixels[index + 3] = 255;
}
const authoritative = inferGridFromReference(conflictPixels, conflictWidth, conflictHeight, [
  { x: 72, y: 52 }, { x: 88, y: 52 }, { x: 88, y: 68 }, { x: 72, y: 68 }
]);
const authoritativeLeft = authoritative.pointAt(0, 1);
const authoritativeRight = authoritative.pointAt(1, 1);
assert(Math.abs(Math.hypot(
  authoritativeRight.x - authoritativeLeft.x,
  authoritativeRight.y - authoritativeLeft.y
) - 8) < 1e-6);

// With no dependable line evidence, expand to every complete cell that fits.
// The source cuts through a cell on the right and bottom, so those fragments
// must be excluded and every returned outer corner must remain in the image.
const clippedWidth = 237, clippedHeight = 173;
const clippedPixels = new Uint8ClampedArray(clippedWidth * clippedHeight * 4);
for (let index = 0; index < clippedPixels.length; index += 4) {
  clippedPixels[index] = 220; clippedPixels[index + 1] = 226;
  clippedPixels[index + 2] = 230; clippedPixels[index + 3] = 255;
}
const clipped = inferGridFromReference(clippedPixels, clippedWidth, clippedHeight, [
  { x: 103, y: 84 }, { x: 123, y: 84 }, { x: 123, y: 104 }, { x: 103, y: 104 }
]);
assert.strictEqual(clipped.columns, 23);
assert.strictEqual(clipped.rows, 16);
assert(clipped.estimated);
clipped.fullPoints.forEach(point => {
  assert(point.x >= 0 && point.y >= 0 && point.x <= clippedWidth && point.y <= clippedHeight);
});
assert(clipped.pointAt(clipped.endColumn + 1, clipped.endRow).x > clippedWidth);
assert(clipped.pointAt(clipped.endColumn, clipped.endRow + 1).y > clippedHeight);

// Imported charts are no longer capped at 160 columns. The natural upper bound
// is the number of complete selected-pitch cells inside the image.
const largeWidth = 800, largeHeight = 40;
const largePixels = new Uint8ClampedArray(largeWidth * largeHeight * 4);
for (let index = 0; index < largePixels.length; index += 4) {
  largePixels[index] = largePixels[index + 1] = largePixels[index + 2] = 245;
  largePixels[index + 3] = 255;
}
const large = inferGridFromReference(largePixels, largeWidth, largeHeight, [
  { x: 400, y: 16 }, { x: 408, y: 16 }, { x: 408, y: 24 }, { x: 400, y: 24 }
]);
assert.strictEqual(large.columns, 200);
assert.strictEqual(large.rows, 10);
assert.strictEqual(fitGridGeometry(large, 180, 8).columns, 180);
assert.throws(() => fitGridGeometry(large, 201, 8), /超出图片完整格范围/);

const largePattern = recognizeChart(
  largePixels, largeWidth, largeHeight, large.fullPoints, large.columns, large.rows,
  rgb => rgb.join(',')
);
assert.strictEqual(largePattern[0].length, 200);
assert.strictEqual(largePattern.length, 10);

// High-contrast pixel-art outlines can look like grid lines only in one narrow
// strip. That local evidence must not collapse the full image to e.g. 6 × 102;
// the 2 × 2 anchor pitch should cover every complete cell that fits.
const pixelArtWidth = 120, pixelArtHeight = 104, pixelArtCell = 4;
const pixelArtPixels = makeOpaqueImage(pixelArtWidth, pixelArtHeight, 244);
for (let row = 0; row <= pixelArtHeight / pixelArtCell; row += 1) {
  const y = row * pixelArtCell;
  if (y >= pixelArtHeight) continue;
  for (let x = 0; x < pixelArtWidth; x += 1) setGrey(pixelArtPixels, pixelArtWidth, x, y, 35);
}
const pixelArtAnchorColumn = 15, pixelArtAnchorRow = 12;
for (let relativeColumn = -2; relativeColumn <= 4; relativeColumn += 1) {
  const x = (pixelArtAnchorColumn + relativeColumn) * pixelArtCell;
  for (
    let y = pixelArtAnchorRow * pixelArtCell;
    y <= (pixelArtAnchorRow + 2) * pixelArtCell;
    y += 1
  ) setGrey(pixelArtPixels, pixelArtWidth, x, y, 35);
}
const pixelArt = inferGridFromReference(
  pixelArtPixels, pixelArtWidth, pixelArtHeight,
  [
    { x: pixelArtAnchorColumn * pixelArtCell, y: pixelArtAnchorRow * pixelArtCell },
    { x: (pixelArtAnchorColumn + 2) * pixelArtCell, y: pixelArtAnchorRow * pixelArtCell },
    { x: (pixelArtAnchorColumn + 2) * pixelArtCell, y: (pixelArtAnchorRow + 2) * pixelArtCell },
    { x: pixelArtAnchorColumn * pixelArtCell, y: (pixelArtAnchorRow + 2) * pixelArtCell }
  ]
);
assert.strictEqual(pixelArt.columns, pixelArtWidth / pixelArtCell);
assert.strictEqual(pixelArt.rows, pixelArtHeight / pixelArtCell);
assert(pixelArt.estimated);

// A perspective reference follows the same containment rule: no inferred outer
// corner may leave the bitmap, even though cell size varies across the photo.
const perspectiveWidth = 300, perspectiveHeight = 240;
const perspectivePixels = new Uint8ClampedArray(perspectiveWidth * perspectiveHeight * 4);
for (let index = 0; index < perspectivePixels.length; index += 4) {
  perspectivePixels[index] = 236; perspectivePixels[index + 1] = 232;
  perspectivePixels[index + 2] = 228; perspectivePixels[index + 3] = 255;
}
const perspective = inferGridFromReference(perspectivePixels, perspectiveWidth, perspectiveHeight, [
  { x: 126, y: 94 }, { x: 174, y: 90 }, { x: 180, y: 142 }, { x: 120, y: 146 }
]);
assert(perspective.columns > 4 && perspective.rows > 4);
perspective.fullPoints.forEach(point => {
  assert(point.x >= -1e-5 && point.y >= -1e-5);
  assert(point.x <= perspectiveWidth + 1e-5 && point.y <= perspectiveHeight + 1e-5);
});

// A PNG may contain a much smaller visible chart surrounded by transparent
// pixels. The green grid must stay inside that visible source area.
const transparentWidth = 300, transparentHeight = 300;
const transparentPixels = new Uint8ClampedArray(transparentWidth * transparentHeight * 4);
for (let y = 100; y < 200; y += 1) for (let x = 50; x < 250; x += 1) {
  const index = (y * transparentWidth + x) * 4;
  transparentPixels[index] = transparentPixels[index + 1] = transparentPixels[index + 2] = 248;
  transparentPixels[index + 3] = 255;
}
assert.deepStrictEqual(
  detectImageContentBounds(transparentPixels, transparentWidth, transparentHeight),
  { left: 50, top: 100, right: 250, bottom: 200 }
);
const transparent = inferGridFromReference(transparentPixels, transparentWidth, transparentHeight, [
  { x: 100, y: 140 }, { x: 120, y: 140 }, { x: 120, y: 160 }, { x: 100, y: 160 }
]);
assert.strictEqual(transparent.columns, 20);
assert.strictEqual(transparent.rows, 10);
transparent.fullPoints.forEach(point => {
  assert(point.x >= 50 && point.x <= 250);
  assert(point.y >= 100 && point.y <= 200);
});

// Generation is fail-open for a slightly oversized range: sampling is clamped
// to source pixels instead of blocking the user with an out-of-image error.
const oversized = recognizeChart(
  pixels, width, height,
  [{ x: -5, y: -5 }, { x: 45, y: -5 }, { x: 45, y: 45 }, { x: -5, y: 45 }],
  4, 4, rgb => rgb.join(',')
);
assert.strictEqual(oversized.length, 4);
assert.strictEqual(oversized[0].length, 4);

function makeOpaqueImage(imageWidth, imageHeight, shade = 250) {
  const data = new Uint8ClampedArray(imageWidth * imageHeight * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = shade;
    data[index + 3] = 255;
  }
  return data;
}

function setGrey(data, imageWidth, x, y, shade) {
  if (x < 0 || y < 0 || x >= imageWidth || (y * imageWidth + x) * 4 >= data.length) return;
  const index = (y * imageWidth + x) * 4;
  data[index] = data[index + 1] = data[index + 2] = shade;
  data[index + 3] = 255;
}

// Regression for the supplied 102 × 156 full-page chart: its outer white grid
// lines are extremely faint, while the central artwork has strong boundaries and
// a materials footer follows below. The old whole-page score returned roughly
// 33 × 92 by keeping only the strong centre.
const pageWidth = 440, pageHeight = 850, pageCell = 4;
const pageLeft = 16, pageTop = 20, pageColumns = 102, pageRows = 156;
const pagePixels = makeOpaqueImage(pageWidth, pageHeight);
for (let row = 32; row < 124; row += 1) for (let column = 34; column < 68; column += 1) {
  for (let y = pageTop + row * pageCell + 1; y < pageTop + (row + 1) * pageCell; y += 1) {
    for (let x = pageLeft + column * pageCell + 1; x < pageLeft + (column + 1) * pageCell; x += 1) {
      setGrey(pagePixels, pageWidth, x, y, 100);
    }
  }
}
for (let column = 0; column <= pageColumns; column += 1) {
  const x = pageLeft + column * pageCell;
  const lineShade = column >= 34 && column <= 68 ? 78 : 247;
  for (let y = pageTop; y <= pageTop + pageRows * pageCell; y += 1) {
    setGrey(pagePixels, pageWidth, x, y, lineShade);
  }
}
for (let row = 0; row <= pageRows; row += 1) {
  const y = pageTop + row * pageCell;
  const lineShade = row >= 32 && row <= 124 ? 78 : 247;
  for (let x = pageLeft; x <= pageLeft + pageColumns * pageCell; x += 1) {
    setGrey(pagePixels, pageWidth, x, y, lineShade);
  }
}
// Representative footer text/noise beneath the grid.
for (let y = 690; y < 750; y += 12) for (let x = 20; x < 400; x += 37) {
  for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 14; dx += 1) {
    setGrey(pagePixels, pageWidth, x + dx, y + dy, 60);
  }
}
const pageReferenceColumn = 50, pageReferenceRow = 70;
const pageReference = [
  { x: pageLeft + pageReferenceColumn * pageCell, y: pageTop + pageReferenceRow * pageCell },
  { x: pageLeft + (pageReferenceColumn + 2) * pageCell, y: pageTop + pageReferenceRow * pageCell },
  { x: pageLeft + (pageReferenceColumn + 2) * pageCell, y: pageTop + (pageReferenceRow + 2) * pageCell },
  { x: pageLeft + pageReferenceColumn * pageCell, y: pageTop + (pageReferenceRow + 2) * pageCell }
];
const fullPage = inferGridFromReference(pagePixels, pageWidth, pageHeight, pageReference);
assert.strictEqual(fullPage.columns, pageColumns);
assert.strictEqual(fullPage.rows, pageRows);

// The supplied 78 × 78 exports use the same faint outer lattice but have a
// square artwork and coordinate/footer content on all four sides.
const squareWidth = 360, squareHeight = 470, squareCell = 4;
const squareLeft = 24, squareTop = 16, squareSize = 78;
const squarePixels = makeOpaqueImage(squareWidth, squareHeight);
for (let row = 0; row <= squareSize; row += 1) {
  for (let x = squareLeft; x <= squareLeft + squareSize * squareCell; x += 1) {
    setGrey(squarePixels, squareWidth, x, squareTop + row * squareCell, row >= 20 && row <= 60 ? 118 : 236);
  }
}
for (let column = 0; column <= squareSize; column += 1) {
  for (let y = squareTop; y <= squareTop + squareSize * squareCell; y += 1) {
    setGrey(squarePixels, squareWidth, squareLeft + column * squareCell, y, column >= 18 && column <= 62 ? 118 : 236);
  }
}
for (let y = 370; y < 430; y += 13) for (let x = 18; x < 335; x += 41) {
  for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 16; dx += 1) {
    setGrey(squarePixels, squareWidth, x + dx, y + dy, 72);
  }
}
const squareReferenceColumn = 38, squareReferenceRow = 38;
const squareReference = [
  { x: squareLeft + squareReferenceColumn * squareCell, y: squareTop + squareReferenceRow * squareCell },
  { x: squareLeft + (squareReferenceColumn + 2) * squareCell, y: squareTop + squareReferenceRow * squareCell },
  { x: squareLeft + (squareReferenceColumn + 2) * squareCell, y: squareTop + (squareReferenceRow + 2) * squareCell },
  { x: squareLeft + squareReferenceColumn * squareCell, y: squareTop + (squareReferenceRow + 2) * squareCell }
];
const squarePage = inferGridFromReference(squarePixels, squareWidth, squareHeight, squareReference);
assert.strictEqual(squarePage.columns, squareSize);
assert.strictEqual(squarePage.rows, squareSize);

// Regression for phone screenshots with opaque black bars above and below a
// 32 × 32 grid. Black bars belong to the bitmap but contain no lattice, so they
// must not become extra rows.
const barWidth = 128, barHeight = 240, barCell = 4, barTop = 56;
const barPixels = makeOpaqueImage(barWidth, barHeight, 0);
for (let y = barTop; y <= barTop + 32 * barCell; y += 1) {
  for (let x = 0; x < barWidth; x += 1) setGrey(barPixels, barWidth, x, y, 250);
}
for (let line = 0; line <= 32; line += 1) {
  const coordinate = line * barCell;
  for (let y = barTop; y <= barTop + 32 * barCell; y += 1) setGrey(barPixels, barWidth, coordinate, y, 170);
  for (let x = 0; x < barWidth; x += 1) setGrey(barPixels, barWidth, x, barTop + coordinate, 170);
}
const barReference = [
  { x: 60, y: barTop + 60 }, { x: 68, y: barTop + 60 },
  { x: 68, y: barTop + 68 }, { x: 60, y: barTop + 68 }
];
const blackBars = inferGridFromReference(barPixels, barWidth, barHeight, barReference);
assert.strictEqual(blackBars.columns, 32);
assert.strictEqual(blackBars.rows, 32);

console.log('chart recognizer tests passed');
