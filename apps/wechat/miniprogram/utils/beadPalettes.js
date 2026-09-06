const { palettes: rawPalettes, brands } = require('../data/beadPalettesData');

const PACKAGE_SIZES = [24, 48, 72, 96, 144, 221];
const cache = new Map();

function rgbDistance(a, b) {
  const dr = a[1] - b[1], dg = a[2] - b[2], db = a[3] - b[3];
  return dr * dr * 0.26 + dg * dg * 0.55 + db * db * 0.19;
}

function normalized(brand) {
  return (rawPalettes[brand] || rawPalettes.mard).map(item => {
    // Mard 实体色卡通常写作 A1、B8；源数据中的 A01 仅是补零格式。
    const code = brand === 'mard' ? item[0].replace(/^([A-Z]+)0+(\d+)$/, '$1$2') : item[0];
    return [code, code, item[1], item[2], item[3]];
  });
}

// Select a broad, nested spectrum instead of taking the first N manufacturer codes.
function spectrumSubset(colors, size) {
  if (size >= colors.length) return colors.slice();
  const key = `${colors.length}:${colors[0][0]}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const selected = [];
  let darkest = colors[0], lightest = colors[0];
  colors.forEach(color => {
    const l = color[2] * .299 + color[3] * .587 + color[4] * .114;
    const dl = darkest[2] * .299 + darkest[3] * .587 + darkest[4] * .114;
    const ll = lightest[2] * .299 + lightest[3] * .587 + lightest[4] * .114;
    if (l < dl) darkest = color;
    if (l > ll) lightest = color;
  });
  selected.push(darkest);
  if (lightest[0] !== darkest[0]) selected.push(lightest);
  while (selected.length < size) {
    let best = null, bestScore = -1;
    colors.forEach(color => {
      if (selected.some(item => item[0] === color[0])) return;
      let nearest = Infinity;
      selected.forEach(item => { nearest = Math.min(nearest, rgbDistance(color.slice(1), item.slice(1))); });
      if (nearest > bestScore) { bestScore = nearest; best = color; }
    });
    if (!best) break;
    selected.push(best);
  }
  const result = colors.filter(color => selected.some(item => item[0] === color[0]));
  cache.set(key, result);
  return result;
}

function getPalette(brand = 'mard', packageSize) {
  const colors = normalized(brand);
  const wanted = Number(packageSize) || colors.length;
  return spectrumSubset(colors, Math.min(wanted, colors.length));
}

function getPackageOptions(brand = 'mard') {
  const meta = brands.find(item => item.value === brand) || brands[0];
  const sizes = PACKAGE_SIZES.filter(size => size < meta.count);
  sizes.push(meta.count);
  return [...new Set(sizes)].map(size => ({ value: size, label: `${size} 色` }));
}

module.exports = { brands, getPalette, getPackageOptions };
