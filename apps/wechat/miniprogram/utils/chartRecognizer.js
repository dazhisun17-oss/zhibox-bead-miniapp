function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

// Unit square -> arbitrary quadrilateral. This is a projective mapping, so
// photographed rectangular charts remain evenly divided after perspective correction.
function createQuadMapper(points) {
  if (!points || points.length !== 4) throw new Error('需要四个图纸角点');
  const [tl, tr, br, bl] = points;
  const dx1 = tr.x - br.x, dx2 = bl.x - br.x;
  const dy1 = tr.y - br.y, dy2 = bl.y - br.y;
  const sx = tl.x - tr.x + br.x - bl.x;
  const sy = tl.y - tr.y + br.y - bl.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  let g = 0, h = 0;
  if (Math.abs(denominator) > 1e-8) {
    g = (sx * dy2 - dx2 * sy) / denominator;
    h = (dx1 * sy - sx * dy1) / denominator;
  }
  const a = tr.x - tl.x + g * tr.x;
  const b = bl.x - tl.x + h * bl.x;
  const c = tl.x;
  const d = tr.y - tl.y + g * tr.y;
  const e = bl.y - tl.y + h * bl.y;
  const f = tl.y;
  return (u, v) => {
    const scale = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / scale, y: (d * u + e * v + f) / scale };
  };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

function validateQuad(points, width, height) {
  if (!points || points.length !== 4) return false;
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  if (points.some(point => point.x < 0 || point.y < 0 || point.x > width || point.y > height)) return false;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const signs = points.map((point, index) => cross(point, points[(index + 1) % 4], points[(index + 2) % 4]));
  const convex = signs.every(value => value > 0) || signs.every(value => value < 0);
  return convex && polygonArea(points) >= width * height * .015;
}

// A 2 × 2 reference occupies only a tiny part of a large chart, so the full-chart
// validator above is intentionally too strict for it. Keep the convexity and
// minimum-side checks here to reject crossed or accidental tap-sized selections.
function validateReferenceQuad(points, width, height) {
  if (!points || points.length !== 4) return false;
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const signs = points.map((point, index) => cross(point, points[(index + 1) % 4], points[(index + 2) % 4]));
  const convex = signs.every(value => value > 0) || signs.every(value => value < 0);
  // Keep this independent of the full image dimensions: a valid 2 × 2 anchor
  // can legitimately be a small portion of a very large chart.
  const minimumSide = 4;
  const sides = points.map((point, index) => {
    const next = points[(index + 1) % 4];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  return convex
    && sides.every(value => value >= minimumSide)
    && polygonArea(points) >= 16;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleLuma(imageData, width, height, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
  const left = Math.floor(x), top = Math.floor(y);
  const right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1);
  const fx = x - left, fy = y - top;
  const at = (column, row) => {
    const index = (row * width + column) * 4;
    if (imageData[index + 3] < 24) return 255;
    return imageData[index] * .299 + imageData[index + 1] * .587 + imageData[index + 2] * .114;
  };
  const upper = at(left, top) * (1 - fx) + at(right, top) * fx;
  const lower = at(left, bottom) * (1 - fx) + at(right, bottom) * fx;
  return upper * (1 - fy) + lower * fy;
}

function trimmedMean(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const start = Math.floor(sorted.length * .2);
  const end = Math.max(start + 1, Math.ceil(sorted.length * .88));
  const usable = sorted.slice(start, end);
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

// Scores a dark grid line against the two neighbouring cell interiors. Searching
// a narrow band makes the match tolerant of finger placement and JPEG blur.
function gridLineScore(imageData, width, height, pointAt, axis, line, crossStart = .12, crossEnd = 1.88, searchOffsets) {
  let best = 0;
  (searchOffsets || [-.12, -.08, -.04, 0, .04, .08, .12]).forEach(searchOffset => {
    const values = [];
    for (let index = 0; index < 29; index += 1) {
      const cross = crossStart + (crossEnd - crossStart) * index / 28;
      const center = axis === 'x' ? pointAt(line + searchOffset, cross) : pointAt(cross, line + searchOffset);
      const before = axis === 'x' ? pointAt(line + searchOffset - .16, cross) : pointAt(cross, line + searchOffset - .16);
      const after = axis === 'x' ? pointAt(line + searchOffset + .16, cross) : pointAt(cross, line + searchOffset + .16);
      const centerLuma = sampleLuma(imageData, width, height, center.x, center.y);
      const beforeLuma = sampleLuma(imageData, width, height, before.x, before.y);
      const afterLuma = sampleLuma(imageData, width, height, after.x, after.y);
      if (centerLuma == null || beforeLuma == null || afterLuma == null) continue;
      // A grid boundary may be darker than white cells or lighter than a dark
      // filled cell. Absolute contrast supports both without assuming the chart
      // uses black lines on a light background.
      values.push(Math.abs((beforeLuma + afterLuma) / 2 - centerLuma));
    }
    best = Math.max(best, trimmedMean(values));
  });
  return best;
}

function pointInsideImage(point, width, height) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.y >= 0 && point.x <= width - 1 && point.y <= height - 1;
}

function detectImageContentBounds(imageData, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (imageData[(row * width + column) * 4 + 3] < 24) continue;
      left = Math.min(left, column); top = Math.min(top, row);
      right = Math.max(right, column); bottom = Math.max(bottom, row);
    }
  }
  if (right < left || bottom < top) return { left: 0, top: 0, right: width, bottom: height };
  // right/bottom are geometric pixel edges rather than the last pixel centres.
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

// Pixel centres end at width - 1 / height - 1, while the geometric outer edge of
// the last complete pixel is width / height. Grid boundaries may therefore sit on
// the latter without sampling outside the bitmap.
function pointInsideImageBoundary(point, width, height, bounds) {
  const epsilon = 1e-5;
  const area = bounds || { left: 0, top: 0, right: width, bottom: height };
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= area.left - epsilon && point.y >= area.top - epsilon
    && point.x <= area.right + epsilon && point.y <= area.bottom + epsilon;
}

function cellInsideImage(pointAt, column, row, width, height, bounds) {
  return [
    pointAt(column, row),
    pointAt(column + 1, row),
    pointAt(column + 1, row + 1),
    pointAt(column, row + 1)
  ].every(point => pointInsideImageBoundary(point, width, height, bounds));
}

function gridSearchBudget(pointAt, width, height) {
  const horizontal = Math.hypot(
    pointAt(1, 1).x - pointAt(0, 1).x,
    pointAt(1, 1).y - pointAt(0, 1).y
  );
  const vertical = Math.hypot(
    pointAt(1, 1).x - pointAt(1, 0).x,
    pointAt(1, 1).y - pointAt(1, 0).y
  );
  const pitch = Math.max(.5, Math.min(horizontal, vertical));
  return Math.max(16, Math.ceil(Math.hypot(width, height) * 4 / pitch) + 8);
}

// Expand from the selected 2 × 2 anchor. A strip is accepted only when every
// cell corner is inside the bitmap, so a clipped border never becomes a cell.
// The budget is derived from image size and selected cell pitch; it is a finite
// loop guard, not a row/column product limit.
function findVisibleGridRange(pointAt, width, height, bounds) {
  let startColumn = 0, endColumn = 2, startRow = 0, endRow = 2;
  const budget = gridSearchBudget(pointAt, width, height);
  const stripFits = (side) => {
    if (side === 'left') {
      for (let row = startRow; row < endRow; row += 1) {
        if (!cellInsideImage(pointAt, startColumn - 1, row, width, height, bounds)) return false;
      }
      return true;
    }
    if (side === 'right') {
      for (let row = startRow; row < endRow; row += 1) {
        if (!cellInsideImage(pointAt, endColumn, row, width, height, bounds)) return false;
      }
      return true;
    }
    if (side === 'top') {
      for (let column = startColumn; column < endColumn; column += 1) {
        if (!cellInsideImage(pointAt, column, startRow - 1, width, height, bounds)) return false;
      }
      return true;
    }
    for (let column = startColumn; column < endColumn; column += 1) {
      if (!cellInsideImage(pointAt, column, endRow, width, height, bounds)) return false;
    }
    return true;
  };
  for (let step = 0; step < budget; step += 1) {
    let changed = false;
    if (stripFits('left')) { startColumn -= 1; changed = true; }
    if (stripFits('right')) { endColumn += 1; changed = true; }
    if (stripFits('top')) { startRow -= 1; changed = true; }
    if (stripFits('bottom')) { endRow += 1; changed = true; }
    if (!changed) return { startColumn, endColumn, startRow, endRow };
  }
  throw new Error('图片透视范围异常，请缩小后重新框选 2×2 四格');
}

function lineEvidenceRange(imageData, width, height, pointAt, axis, visible) {
  const start = axis === 'x' ? visible.startColumn : visible.startRow;
  const end = axis === 'x' ? visible.endColumn : visible.endRow;
  const scores = new Map();
  for (let line = start; line <= end; line += 1) {
    // Judge every candidate boundary only through the two rows/columns selected
    // by the user. Full-page exports often have a legend below the chart and
    // strong artwork in the middle; scoring across that entire page made those
    // regions dominate and collapsed a 102-column chart to its central 33 columns.
    scores.set(line, gridLineScore(imageData, width, height, pointAt, axis, line));
  }
  const referenceScores = [0, 1, 2].map(line => scores.get(line) || 0);
  // Exported grid lines can differ from a white cell by only one or two luma
  // levels. Keep a low ceiling even when the selected four cells have dark,
  // high-contrast borders; otherwise only the coloured centre survives.
  const baseline = clamp(median(referenceScores) * .08, .35, 1.35);
  const strong = Array.from(scores.entries())
    .filter(([, score]) => score >= baseline)
    .map(([line]) => line);
  const clusters = [];
  strong.forEach(line => {
    const current = clusters[clusters.length - 1];
    if (!current || line - current.end > 6) {
      clusters.push({ start: line, end: line, count: 1 });
    } else {
      current.end = line;
      current.count += 1;
    }
  });
  // Use the continuous lattice component containing the selected 2 × 2 anchor.
  // This prevents material-list text or coordinate labels farther away from
  // extending the chart, while still bridging a few weak/covered grid lines.
  const anchored = clusters
    .filter(cluster => cluster.start <= 0 && cluster.end >= 2)
    .sort((left, right) => {
      const leftDensity = left.count / Math.max(1, left.end - left.start + 1);
      const rightDensity = right.count / Math.max(1, right.end - right.start + 1);
      return (right.end - right.start) - (left.end - left.start) || rightDensity - leftDensity;
    })[0];
  if (!anchored || anchored.count < 3) {
    return { start, end, estimated: true, scores, threshold: baseline };
  }
  // A chart can be cropped exactly on its outer grid boundary. Such a boundary
  // has pixels on only one side, so gridLineScore deliberately cannot score it.
  // If the anchored lattice reaches the last supported line immediately next to
  // the complete-cell containment limit, include that single geometric edge.
  // This recovers e.g. a 32 × 32 grid spanning x=0..width without ever extending
  // past the bitmap or accepting a partial outside cell.
  const evidenceStart = anchored.start - start <= 1 ? start : anchored.start;
  const evidenceEnd = end - anchored.end <= 1 ? end : anchored.end;
  const evidenceCount = evidenceEnd - evidenceStart;
  if (evidenceCount < 2) {
    return { start, end, estimated: true, scores, threshold: baseline };
  }
  return {
    start: evidenceStart,
    end: evidenceEnd,
    estimated: false,
    scores,
    threshold: baseline
  };
}

// Pixel-art outlines, weapons and other high-contrast artwork can accidentally
// resemble a short run of grid lines. Never let that local run collapse an axis
// to a small strip when the selected 2 × 2 pitch can place many complete cells
// across the bitmap. Genuine chart borders normally retain a substantial part
// of the geometrically visible range; weak/tiny evidence falls back to that full
// complete-cell range, which still discards partial cells at the image edges.
function preserveWholeGridCoverage(evidence, visibleStart, visibleEnd) {
  const visibleCount = visibleEnd - visibleStart;
  const evidenceCount = evidence.end - evidence.start;
  if (visibleCount >= 8 && evidenceCount / visibleCount < .32) {
    return {
      ...evidence,
      start: visibleStart,
      end: visibleEnd,
      estimated: true,
      rejectedTinyEvidence: true
    };
  }
  return evidence;
}

function buildGridGeometry(
  pointAt, startColumn, endColumn, startRow, endRow,
  confidence, lineScore, estimated = false, visible, contentBounds
) {
  const columns = endColumn - startColumn, rows = endRow - startRow;
  const limits = visible || { startColumn, endColumn, startRow, endRow };
  return {
    pointAt, startColumn, endColumn, startRow, endRow, columns, rows,
    confidence, lineScore, estimated,
    visibleStartColumn: limits.startColumn,
    visibleEndColumn: limits.endColumn,
    visibleStartRow: limits.startRow,
    visibleEndRow: limits.endRow,
    contentBounds: contentBounds || null,
    fullPoints: [
      pointAt(startColumn, startRow),
      pointAt(endColumn, startRow),
      pointAt(endColumn, endRow),
      pointAt(startColumn, endRow)
    ]
  };
}

// The supplied quadrilateral is authoritative: it surrounds exactly 2 × 2 cells
// and directly determines pitch, phase and perspective. Image-wide evidence may
// trim blank margins, but must never rescale or re-phase the user's selection.
function inferGridFromReference(imageData, width, height, referencePoints) {
  if (!validateReferenceQuad(referencePoints, width, height)) {
    throw new Error('四格参考框范围过小或角点交叉，请重新框选完整的 2×2 四格');
  }
  if (!imageData || imageData.length < width * height * 4) throw new Error('图纸像素数据不完整');
  const quadMap = createQuadMapper(referencePoints);
  const pointAt = (column, row) => quadMap(column / 2, row / 2);
  const xReferenceScores = [0, 1, 2].map(line => gridLineScore(imageData, width, height, pointAt, 'x', line));
  const yReferenceScores = [0, 1, 2].map(line => gridLineScore(imageData, width, height, pointAt, 'y', line));
  const referenceLineScore = median(xReferenceScores.concat(yReferenceScores));
  const contentBounds = detectImageContentBounds(imageData, width, height);
  let visible;
  try {
    visible = findVisibleGridRange(pointAt, width, height, contentBounds);
  } catch (_) {
    // The user's selected four cells are still usable even when extreme
    // perspective prevents reliable outward expansion.
    visible = { startColumn: 0, endColumn: 2, startRow: 0, endRow: 2 };
  }
  const columnEvidence = preserveWholeGridCoverage(
    lineEvidenceRange(imageData, width, height, pointAt, 'x', visible),
    visible.startColumn, visible.endColumn
  );
  const rowEvidence = preserveWholeGridCoverage(
    lineEvidenceRange(imageData, width, height, pointAt, 'y', visible),
    visible.startRow, visible.endRow
  );
  const startColumn = columnEvidence.start, endColumn = columnEvidence.end;
  const startRow = rowEvidence.start, endRow = rowEvidence.end;
  const columns = endColumn - startColumn, rows = endRow - startRow;
  const confidence = Math.min(1, referenceLineScore / 18);
  return buildGridGeometry(
    pointAt, startColumn, endColumn, startRow, endRow,
    confidence, referenceLineScore,
    columnEvidence.estimated || rowEvidence.estimated,
    visible, contentBounds
  );
}

function fitGridGeometry(geometry, columns, rows) {
  if (!geometry || typeof geometry.pointAt !== 'function') throw new Error('网格尚未自动匹配');
  const wantedColumns = Math.round(columns), wantedRows = Math.round(rows);
  if (!Number.isFinite(wantedColumns) || !Number.isFinite(wantedRows) || wantedColumns < 2 || wantedRows < 2) {
    throw new Error('横向和纵向格数不能少于 2');
  }
  const resizeAxis = (start, end, count, visibleStart, visibleEnd) => {
    if (count > visibleEnd - visibleStart) throw new Error('修正后的格数会超出图片完整格范围');
    const minimumStart = Math.max(visibleStart, 2 - count);
    const maximumStart = Math.min(0, visibleEnd - count);
    if (minimumStart > maximumStart) throw new Error('修正后的格数无法保留框选的四格');
    const ideal = (start + end - count) / 2;
    return clamp(Math.round(ideal), minimumStart, maximumStart);
  };
  const visible = {
    startColumn: geometry.visibleStartColumn == null ? geometry.startColumn : geometry.visibleStartColumn,
    endColumn: geometry.visibleEndColumn == null ? geometry.endColumn : geometry.visibleEndColumn,
    startRow: geometry.visibleStartRow == null ? geometry.startRow : geometry.visibleStartRow,
    endRow: geometry.visibleEndRow == null ? geometry.endRow : geometry.visibleEndRow
  };
  const startColumn = resizeAxis(
    geometry.startColumn, geometry.endColumn, wantedColumns,
    visible.startColumn, visible.endColumn
  );
  const startRow = resizeAxis(
    geometry.startRow, geometry.endRow, wantedRows,
    visible.startRow, visible.endRow
  );
  return buildGridGeometry(
    geometry.pointAt,
    startColumn, startColumn + wantedColumns,
    startRow, startRow + wantedRows,
    geometry.confidence, geometry.lineScore, geometry.estimated, visible, geometry.contentBounds
  );
}

function robustCellColor(samples) {
  if (!samples.length) return [255, 255, 255];
  const luma = sample => sample[0] * .299 + sample[1] * .587 + sample[2] * .114;
  const dark = samples.filter(sample => luma(sample) < 72);
  // Printed color codes are usually a minority of very dark pixels. Preserve a genuinely
  // black/dark bead cell when dark pixels occupy most of the sampled interior.
  const usable = dark.length > 0 && dark.length / samples.length < .42
    ? samples.filter(sample => luma(sample) >= 72)
    : samples;
  const source = usable.length >= 3 ? usable : samples;
  const bins = new Map();
  source.forEach(sample => {
    const key = `${Math.round(sample[0] / 24)},${Math.round(sample[1] / 24)},${Math.round(sample[2] / 24)}`;
    const item = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    item.count += 1; item.r += sample[0]; item.g += sample[1]; item.b += sample[2];
    bins.set(key, item);
  });
  const best = Array.from(bins.values()).sort((left, right) => right.count - left.count)[0];
  return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
}

// JPEG compression can make an otherwise uniform white/grey background alternate
// between adjacent manufacturer neutrals (for example H1/H2/H9). Only collapse an
// isolated neutral when a strong local majority surrounds it; coloured artwork and
// deliberate larger grey regions are left untouched.
function stabilizeNeutralCells(pattern) {
  if (!pattern.length || !pattern[0].length) return pattern;
  const neutral = color => {
    if (!Array.isArray(color) || color.length < 5) return false;
    const rgb = color.slice(2, 5), chroma = Math.max(...rgb) - Math.min(...rgb);
    const luma = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114;
    return chroma <= 22 && luma >= 210;
  };
  const close = (left, right) => {
    const dr = left[2] - right[2], dg = left[3] - right[3], db = left[4] - right[4];
    return dr * dr + dg * dg + db * db <= 34 * 34;
  };
  let current = pattern.map(row => row.slice());
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.map(row => row.slice());
    for (let row = 0; row < current.length; row += 1) for (let column = 0; column < current[row].length; column += 1) {
      const color = current[row][column];
      if (!neutral(color)) continue;
      const neighbours = [];
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if ((!dx && !dy) || !current[row + dy] || !current[row + dy][column + dx]) continue;
        const candidate = current[row + dy][column + dx];
        if (neutral(candidate) && close(color, candidate)) neighbours.push(candidate);
      }
      if (neighbours.length < 3) continue;
      const counts = new Map();
      neighbours.forEach(candidate => {
        const key = candidate[0], item = counts.get(key) || { color: candidate, count: 0 };
        item.count += 1;counts.set(key, item);
      });
      const majority = Array.from(counts.values()).sort((left, right) => right.count - left.count)[0];
      if (majority.color[0] !== color[0] && majority.count >= Math.max(3, Math.ceil(neighbours.length * .62))) {
        next[row][column] = majority.color;
      }
    }
    current = next;
  }
  return current;
}

function recognizeChart(imageData, imageWidth, imageHeight, points, columns, rows, matchColor) {
  if (!points || points.length !== 4 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('网格角点数据无效');
  }
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error('横向和纵向格数不能少于 1');
  }
  if (!imageData || imageData.length < imageWidth * imageHeight * 4) throw new Error('图纸像素数据不完整');
  const map = createQuadMapper(points);
  const offsets = [.2, .35, .5, .65, .8];
  const pattern = Array.from({ length: rows }, () => Array(columns));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const samples = [];
      offsets.forEach(yOffset => offsets.forEach(xOffset => {
        const point = map((column + xOffset) / columns, (row + yOffset) / rows);
        // Fail open at the bitmap edge. Correctly inferred grids never need this,
        // but a slightly oversized manual/automatic range must still generate.
        const x = clamp(Math.round(point.x), 0, imageWidth - 1);
        const y = clamp(Math.round(point.y), 0, imageHeight - 1);
        const index = (y * imageWidth + x) * 4;
        if (imageData[index + 3] >= 24) samples.push([imageData[index], imageData[index + 1], imageData[index + 2]]);
      }));
      pattern[row][column] = matchColor(robustCellColor(samples), column, row);
    }
  }
  return pattern;
}

module.exports = {
  createQuadMapper, validateQuad, validateReferenceQuad,
  detectImageContentBounds, inferGridFromReference, fitGridGeometry,
  robustCellColor, stabilizeNeutralCells, recognizeChart
};
