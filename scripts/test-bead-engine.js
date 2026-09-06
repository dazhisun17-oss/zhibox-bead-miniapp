const assert = require('assert');
const {
  mapPixels, prepareSubjectSample, recount, rgbToLab, inferSourceKind, analyzeQrStructure
} = require('../apps/wechat/miniprogram/utils/beadEngine');
const { getPalette } = require('../apps/wechat/miniprogram/utils/beadPalettes');
const qrcode = require('../apps/wechat/miniprogram/node_modules/qrcode-generator');

const palette = getPalette('mard', 221);

function canvas(width, height, background = [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position += 1) {
    const index = position * 4;
    data[index] = background[0]; data[index + 1] = background[1]; data[index + 2] = background[2]; data[index + 3] = 255;
  }
  return data;
}

function setPixel(data, width, x, y, color) {
  const index = (y * width + x) * 4;
  data[index] = color[0]; data[index + 1] = color[1]; data[index + 2] = color[2]; data[index + 3] = 255;
}

function rectangle(data, width, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) setPixel(data, width, x, y, color);
}

function options(mode, longSide, sourceKind = 'illustration') {
  return {
    brightness: 100, contrast: 100, saturation: 100, accentBoost: 1,
    regionMode: mode, minimumRegionArea: longSide <= 36 ? 2 : (longSide <= 60 ? 3 : (longSide <= 84 ? 4 : 5)), preserveKeyFeatures: true,
    localBackground: true, backgroundMode: 'subject', preserveOutline: true,
    outlineMode: longSide <= 52 ? 'auto' : 'off', preserveEyeHighlights: true,
    restoreInterior: true, physicalIntegrity: true, removeNoise: false, smoothEdges: false,
    blackBoundary: longSide <= 52, boundaryRounding: longSide <= 36 ? 2 : 1,
    boundaryBumpPasses: 2, ensureClosedBoundary: longSide <= 52,
    sourceKind
  };
}

function codes(pattern) {
  return new Set(pattern.flat().filter(Boolean).map(color => color[0]));
}

function count(pattern, predicate = Boolean) {
  return pattern.flat().filter(predicate).length;
}

function beadLightness(color) {
  return color ? color[2] * .299 + color[3] * .587 + color[4] * .114 : 0;
}

function assertSameOccupancyMask(first, second, label) {
  assert.strictEqual(first.length, second.length, `${label}: 高度不一致`);
  for (let y = 0; y < first.length; y += 1) {
    assert.strictEqual(first[y].length, second[y].length, `${label}: 第 ${y} 行宽度不一致`);
    for (let x = 0; x < first[y].length; x += 1) {
      assert.strictEqual(Boolean(first[y][x]), Boolean(second[y][x]), `${label}: (${x}, ${y}) 的占用 mask 不一致`);
    }
  }
}

function hue(lab) {
  let value = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
  if (value < 0) value += 360;
  return value;
}

function hueFamily(color) {
  const value = hue(rgbToLab([color[2], color[3], color[4]]));
  if (value < 45 || value >= 335) return 'red-pink';
  if (value < 80) return 'orange';
  if (value < 115) return 'yellow';
  if (value < 175) return 'green';
  if (value < 245) return 'cyan';
  if (value < 305) return 'blue';
  return 'purple';
}

function buildReferenceLike(size) {
  const data = canvas(size, size), margin = Math.round(size * .11), end = size - margin - 1;
  rectangle(data, size, margin, margin, end, end, [8, 8, 8]);
  rectangle(data, size, margin + 1, margin + 1, end - 1, end - 1, [244, 224, 184]);
  const shades = [[250, 175, 85], [245, 155, 60], [238, 132, 42], [226, 105, 28], [210, 82, 20]];
  const bandWidth = Math.max(2, Math.floor((end - margin - 2) / shades.length));
  shades.forEach((color, index) => rectangle(data, size, margin + 2 + index * bandWidth, margin + 2, Math.min(end - 2, margin + 1 + (index + 1) * bandWidth), Math.round(size * .34), color));
  rectangle(data, size, Math.round(size * .27), Math.round(size * .4), Math.round(size * .42), Math.round(size * .59), [4, 4, 4]);
  rectangle(data, size, Math.round(size * .58), Math.round(size * .4), Math.round(size * .73), Math.round(size * .59), [4, 4, 4]);
  setPixel(data, size, Math.round(size * .34), Math.round(size * .46), [255, 255, 255]);
  setPixel(data, size, Math.round(size * .65), Math.round(size * .46), [255, 255, 255]);
  // 被深色眼睛包围的彩色小点缀必须保留。
  setPixel(data, size, Math.round(size * .37), Math.round(size * .53), [245, 214, 45]);
  const accents = [[225, 50, 55], [240, 130, 35], [240, 210, 45], [60, 175, 80], [45, 190, 190], [45, 95, 220], [145, 75, 200]];
  const step = Math.max(2, Math.floor((end - margin - 5) / accents.length));
  accents.forEach((color, index) => rectangle(data, size, margin + 3 + index * step, Math.round(size * .69), margin + 4 + index * step, Math.round(size * .72), color));
  return data;
}

const report = [];

for (const size of [32, 52, 78, 104]) {
  const data = buildReferenceLike(size);
  const rich = mapPixels(data, size, size, palette, options('rich', size));
  const compact = mapPixels(data, size, size, palette, options('compact', size));
  const richCodes = codes(rich), compactCodes = codes(compact);
  assertSameOccupancyMask(compact, rich, `${size}: 减少/丰富模式`);
  assert([...compactCodes].every(code => richCodes.has(code)), `${size}: 减少模式出现了丰富模式没有的色号`);
  assert(compactCodes.size <= richCodes.size, `${size}: 减少模式色数反超丰富模式`);
  assert(compactCodes.has('H7'), `${size}: 黑色结构丢失`);
  const compactColors = [...compactCodes].map(code => palette.find(color => color[0] === code)).filter(Boolean);
  const families = new Set(compactColors.filter(color => Math.hypot(...rgbToLab([color[2], color[3], color[4]]).slice(1)) > 18).map(hueFamily));
  assert(families.size >= 6, `${size}: 七色点缀被过度合并`);
  const blackRatio = count(compact, color => color && color[0] === 'H7') / count(compact);
  assert(blackRatio < .38, `${size}: 黑色扩张过多`);
  report.push({ size, richColors: richCodes.size, compactColors: compactCodes.size, blackRatio: Number(blackRatio.toFixed(3)) });
}

// 黑底不能被“暗色就是主体”的旧规则整块保留。
{
  const size = 52, data = canvas(size, size, [8, 8, 8]);
  rectangle(data, size, 13, 10, 38, 42, [238, 218, 178]);
  rectangle(data, size, 18, 18, 22, 25, [0, 0, 0]);
  rectangle(data, size, 29, 18, 33, 25, [0, 0, 0]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size));
  assert.strictEqual(pattern[0][0], null, '黑色背景没有清除');
  assert(count(pattern) < 1000, '黑色背景仍占据大部分图纸');
}

// 同一橙色区域的多档柔和光影在智能模式下应归为一个大色块。
{
  const size = 52, data = canvas(size, size), shades = [[250, 175, 85], [245, 155, 60], [240, 135, 45], [230, 115, 35], [220, 95, 25], [210, 80, 20], [200, 65, 15], [190, 55, 10]];
  rectangle(data, size, 6, 6, 45, 45, [0, 0, 0]); rectangle(data, size, 7, 7, 44, 44, shades[0]);
  shades.forEach((color, index) => rectangle(data, size, 7 + index * 4, 7, 10 + index * 4, 44, color));
  const rich = mapPixels(data, size, size, palette, options('rich', size));
  const compact = mapPixels(data, size, size, palette, options('compact', size));
  assert(codes(rich).size > codes(compact).size, '智能模式没有减少同色相渐变色号');
  assert(codes(compact).size <= 3, '单一橙色主体没有归成大色块');
}

// 黑色外框上只有一格、后方有连续三格支撑的毛刺应被吸收。
{
  const size = 52, data = canvas(size, size);
  rectangle(data, size, 12, 12, 39, 39, [240, 150, 60]);
  setPixel(data, size, 11, 25, [240, 150, 60]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size));
  assert.strictEqual(pattern[25][11], null, '黑色边框的一格凸角没有吸收');
  assert(pattern[24][12] && pattern[25][12] && pattern[26][12], '吸收凸角时破坏了主体边线');
}

// 以下回归来自真实用户图的缺陷类型。集中收集失败，方便一次看到新引擎还需
// 修复哪些行为；任何一项失败仍会让脚本返回非零状态。
const regressionFailures = [];
function regression(name, run) {
  try { run(); } catch (error) { regressionFailures.push({ name, message: error.message }); }
}

// 78 格白色主体放在黑底上时，黑底要清除，但主体里的真白与浅灰结构必须保留。
// 不能为了去背景或减少颜色把白衣、白毛和浅色道具一起挖空。
regression('78 白主体/黑背景保留真白与浅色结构', () => {
  const size = 78, data = canvas(size, size, [7, 7, 7]);
  rectangle(data, size, 18, 9, 59, 68, [248, 246, 239]);
  rectangle(data, size, 27, 19, 50, 42, [255, 255, 255]);
  rectangle(data, size, 24, 47, 53, 50, [183, 190, 202]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size, 'photo'));
  assert.strictEqual(pattern[0][0], null, '黑色背景没有清除');
  assert(pattern[28][36], '白色主体内部被挖空');
  assert(beadLightness(pattern[28][36]) >= 240, '真白区域被错误压成米色或深色');
  assert(pattern[48][36], '浅灰结构线被删除');
  assert.notStrictEqual(pattern[48][36][0], pattern[28][36][0], '浅灰结构线与真白填充被合并');
});

// 字母 O、眼镜、圆环等 graphic 的封闭孔洞是有意义的负空间，不是白色主体
// 的漏填。即使开启主体完整性，也不能把孔洞补成拼豆。
regression('32 黑色 O 字孔洞保持为空', () => {
  const size = 32, data = canvas(size, size);
  rectangle(data, size, 7, 5, 24, 26, [4, 4, 4]);
  rectangle(data, size, 11, 9, 20, 22, [255, 255, 255]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size, 'graphic'));
  assert(pattern[5][15] && pattern[5][15][0] === 'H7', 'O 字本体黑色丢失');
  assert.strictEqual(pattern[15][15], null, 'O 字内部负空间被错误填满');
});

// 文字、Logo、现成像素图应忠于原图结构：没有黑边的粉色色块不能被强制套
// 黑框，直角也不能被面向照片主体的“圆角/削角”处理改掉。
regression('graphic 不强制黑包边或削角', () => {
  const size = 32, data = canvas(size, size);
  rectangle(data, size, 7, 7, 24, 24, [242, 52, 150]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size, 'graphic'));
  assert(pattern[7][7], 'graphic 原有直角被削掉');
  assert.notStrictEqual(pattern[7][7][0], 'H7', 'graphic 被强制添加黑色包边');
  assert(!codes(pattern).has('H7'), '原图没有黑色却新增了黑色色号');
});

// 一格宽的彩色天线、丝带、触角或文字笔画虽然全都接触背景，但本身就是有
// 意义的连续彩色结构，不能因为“小图包黑边”而整条变黑。
regression('52 彩色一格宽连续天线保留原色', () => {
  const size = 52, data = canvas(size, size);
  rectangle(data, size, 14, 20, 37, 43, [70, 180, 112]);
  for (let y = 6; y <= 20; y += 1) setPixel(data, size, 22, y, [35, 145, 225]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size, 'illustration'));
  const antenna = [];
  for (let y = 6; y <= 19; y += 1) antenna.push(pattern[y][22]);
  assert(antenna.every(Boolean), '连续天线被截断或删除');
  assert(antenna.some(color => color[0] !== 'H7'), '彩色天线被全部改成黑色');
});

// 减少颜色只能修改色号，不得改变哪些位置需要放豆。这样用户切换模式时，
// 图纸轮廓、颗数和封闭孔洞都保持一致；compact 使用的色号必须来自 rich。
regression('compact 是 rich 的同 mask 色号子集', () => {
  const size = 52, data = buildReferenceLike(size);
  // 加一个封闭负空间和一条细彩色结构，避免只验证简单矩形。
  rectangle(data, size, 21, 31, 30, 39, [5, 5, 5]);
  rectangle(data, size, 24, 33, 27, 37, [255, 255, 255]);
  for (let y = 5; y <= 13; y += 1) setPixel(data, size, 42, y, [45, 110, 220]);
  const rich = mapPixels(data, size, size, palette, options('rich', size));
  const compact = mapPixels(data, size, size, palette, options('compact', size));
  assertSameOccupancyMask(compact, rich, '52 复杂主体');
  const richCodes = codes(rich), compactCodes = codes(compact);
  assert([...compactCodes].every(code => richCodes.has(code)), 'compact 出现 rich 没有使用的色号');
  assert(compactCodes.size <= richCodes.size, 'compact 色数反而多于 rich');
});

// 左右分离但肉眼同色的耳朵/袖子要跨区域共用同一色号；与此同时，黑色眼睛、
// 白色眼神光和显著的亮黄色高光仍然是独立语义结构，不能被大色块归一吞掉。
regression('跨区域同色复用且保留五官和高光', () => {
  const size = 78, data = canvas(size, size);
  rectangle(data, size, 8, 8, 69, 69, [238, 222, 190]);
  rectangle(data, size, 13, 13, 29, 28, [245, 146, 54]);
  rectangle(data, size, 49, 13, 65, 28, [233, 126, 43]);
  // 两块区域中的轻微抗锯齿/光照变化仍应归入共同主色。
  rectangle(data, size, 25, 13, 29, 28, [238, 134, 47]);
  rectangle(data, size, 49, 13, 53, 28, [240, 138, 50]);
  rectangle(data, size, 22, 36, 32, 50, [4, 4, 4]);
  rectangle(data, size, 46, 36, 56, 50, [4, 4, 4]);
  rectangle(data, size, 25, 39, 28, 42, [255, 255, 255]);
  rectangle(data, size, 49, 39, 52, 42, [255, 255, 255]);
  rectangle(data, size, 14, 14, 17, 17, [255, 224, 45]);
  const pattern = mapPixels(data, size, size, palette, options('compact', size));
  assert(pattern[20][19] && pattern[20][58], '左右同色区域被删除');
  assert.strictEqual(pattern[20][19][0], pattern[20][58][0], '跨区域近似橙色没有复用同一主色号');
  assert(pattern[44][27] && pattern[44][27][0] === 'H7', '黑色眼睛结构丢失');
  assert(pattern[40][26] && beadLightness(pattern[40][26]) >= 235, '眼睛白色高光丢失或变暗');
  assert(pattern[15][15] && pattern[15][15][0] !== pattern[20][19][0], '显著黄色高光被合并进橙色主色');
});

// 调用方明确指定的硬边双色素材仍支持抗锯齿归色。自动导入不再依赖这条
// 宽松通道判断二维码；真实二维码由下一项结构回归验证后才会进入 binary。
regression('明确指定的 64 格硬边双色素材严格保持两色', () => {
  const sourceSize = 256, targetSize = 64, modules = 29, quiet = 4;
  const data = canvas(sourceSize, sourceSize);
  const finderDark = (moduleX, moduleY, startX, startY) => {
    const x = moduleX - startX, y = moduleY - startY;
    if (x < 0 || y < 0 || x >= 7 || y >= 7) return false;
    return x === 0 || y === 0 || x === 6 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
  };
  for (let y = 0; y < sourceSize; y += 1) for (let x = 0; x < sourceSize; x += 1) {
    const moduleX = Math.min(modules - 1, Math.floor(x * modules / sourceSize));
    const moduleY = Math.min(modules - 1, Math.floor(y * modules / sourceSize));
    const inside = moduleX >= quiet && moduleY >= quiet && moduleX < modules - quiet && moduleY < modules - quiet;
    const qrX = moduleX - quiet, qrY = moduleY - quiet;
    const finder = finderDark(qrX, qrY, 0, 0) || finderDark(qrX, qrY, 14, 0) || finderDark(qrX, qrY, 0, 14);
    const payload = inside && !finder && ((qrX * 3 + qrY * 5 + qrX * qrY) % 7 < 3);
    if (finder || payload) setPixel(data, sourceSize, x, y, [0, 0, 0]);
  }
  const sample = prepareSubjectSample(data, sourceSize, sourceSize, targetSize, targetSize, {
    localBackground: false,
    backgroundMode: 'auto',
    sourceKind: 'binary'
  });
  assert.strictEqual(sample.sourceKind, 'binary', '明确指定的双色素材没有保留 binary 类型');
  const pattern = mapPixels(sample.data, sample.width, sample.height, palette, {
    ...options('compact', targetSize),
    localBackground: false,
    sourceKind: sample.sourceKind,
    blackBoundary: false
  });
  const resultCodes = codes(pattern);
  assert.strictEqual(count(pattern), targetSize * targetSize, '双色素材被错误添加空白无豆边框');
  assert.deepStrictEqual([...resultCodes].sort(), ['H2', 'H7'], '双色素材抗锯齿没有归回严格黑白两色');
});

// 真实 QR 不能只做“黑白聚类”，必须先恢复标准模块矩阵。相同 QR 在 52
// 和 78 格中应使用整数豆格倍率、保留静区并严格只出现两种材料色。
regression('真实 QR 在 52/78 格重建模块且严格两色', () => {
  const qr = qrcode(0, 'H');
  qr.addData('https://samvibe.top/qr-module-regression', 'Byte');
  qr.make();
  const moduleCount = qr.getModuleCount(), quiet = 4, modulePixels = 6;
  const sourceSize = (moduleCount + quiet * 2) * modulePixels;
  const data = canvas(sourceSize, sourceSize, [248, 247, 245]);
  for (let y = 0; y < sourceSize; y += 1) for (let x = 0; x < sourceSize; x += 1) {
    const moduleX = Math.floor(x / modulePixels) - quiet, moduleY = Math.floor(y / modulePixels) - quiet;
    const dark = moduleX >= 0 && moduleY >= 0 && moduleX < moduleCount && moduleY < moduleCount && qr.isDark(moduleY, moduleX);
    const edge = x % modulePixels === 0 || y % modulePixels === 0;
    const base = dark ? (edge ? 52 : 12) : (edge ? 226 : 248);
    const noise = ((x * 13 + y * 7) % 9) - 4;
    setPixel(data, sourceSize, x, y, [base + noise, base + noise, base + noise]);
  }
  const structure = analyzeQrStructure(data, sourceSize, sourceSize);
  assert(structure, '没有识别出标准 QR 三定位框');
  assert.strictEqual(structure.moduleCount, moduleCount, 'QR 模块数识别错误');
  [52, 78].forEach(targetSize => {
    const sample = prepareSubjectSample(data, sourceSize, sourceSize, targetSize, targetSize, {
      localBackground: false,
      sourceKind: 'auto'
    });
    assert(sample.qrStructure, `${targetSize}: 没有走 QR 模块重建路径`);
    assert.strictEqual(sample.qrModuleCount, moduleCount, `${targetSize}: 重建模块数错误`);
    assert(Number.isInteger(sample.qrScale), `${targetSize}: 使用了非整数模块倍率`);
    const pattern = mapPixels(sample.data, sample.width, sample.height, palette, {
      ...options('compact', targetSize),
      localBackground: false,
      sourceKind: sample.sourceKind,
      blackBoundary: false
    });
    assert.deepStrictEqual([...codes(pattern)].sort(), ['H2', 'H7'], `${targetSize}: QR 仍然出现第三种材料色`);
  });
});

regression('普通多色图不会误判为双色', () => {
  const size = 52, data = buildReferenceLike(size);
  assert.notStrictEqual(inferSourceKind(data, size, size, { sourceKind: 'auto' }), 'binary', '普通多色插画被误判为双色图');
});

// 真实用户缺陷：白底上的深蓝制服人物会让两簇算法把白底当一簇，把蓝衣、
// 肤色、金色帽徽和腰带全塞进另一簇。它看起来“近似两大类”，但绝不是需要
// 强制两色的二维码/Logo，人物的重要颜色必须继续走普通插画映射。
regression('白底深蓝制服人物不会误判为双色', () => {
  const size = 104, data = canvas(size, size);
  rectangle(data, size, 35, 9, 68, 19, [35, 48, 137]);       // 制服帽
  rectangle(data, size, 39, 12, 64, 14, [229, 181, 45]);     // 帽带/帽徽
  rectangle(data, size, 40, 20, 63, 42, [240, 178, 145]);    // 肤色
  rectangle(data, size, 43, 25, 47, 29, [30, 24, 28]);       // 五官
  rectangle(data, size, 56, 25, 60, 29, [30, 24, 28]);
  rectangle(data, size, 30, 43, 73, 94, [38, 51, 139]);      // 深蓝制服
  rectangle(data, size, 32, 50, 39, 86, [52, 66, 155]);      // 蓝色明暗
  rectangle(data, size, 64, 50, 71, 86, [28, 42, 120]);
  rectangle(data, size, 31, 70, 72, 75, [224, 174, 48]);     // 金腰带
  rectangle(data, size, 48, 44, 55, 63, [246, 246, 241]);    // 白衬衣
  assert.notStrictEqual(inferSourceKind(data, size, size, { sourceKind: 'auto' }), 'binary', '彩色制服人物被错误压成两色');
});

// 真实用户缺陷：大面积黑发和白底会把彩色 Q 版人物近似成“黑白两簇”，
// 但它没有 QR 的三枚定位框、时序线和标准模块网格，绝不能进入强制两色。
regression('白底深色卡通人物没有 QR 结构时不会强制两色', () => {
  const size = 104, data = canvas(size, size);
  rectangle(data, size, 25, 11, 72, 55, [13, 12, 25]);      // 大面积深色头发
  rectangle(data, size, 34, 29, 68, 61, [235, 208, 196]);   // 肤色
  rectangle(data, size, 39, 44, 46, 48, [17, 15, 22]);      // 眼睛
  rectangle(data, size, 57, 44, 64, 48, [17, 15, 22]);
  rectangle(data, size, 35, 62, 68, 91, [244, 244, 240]);   // 白衣
  rectangle(data, size, 32, 64, 42, 83, [44, 174, 182]);    // 青色衣饰
  rectangle(data, size, 61, 64, 71, 83, [92, 65, 150]);     // 紫色衣饰
  rectangle(data, size, 43, 80, 60, 94, [60, 45, 35]);      // 棕色鞋裤
  assert.strictEqual(analyzeQrStructure(data, size, size), null, '卡通人物被错误识别出 QR 模块结构');
  const sample = prepareSubjectSample(data, size, size, 52, 52, {
    localBackground: true,
    backgroundMode: 'subject',
    sourceKind: 'auto'
  });
  assert.notStrictEqual(sample.sourceKind, 'binary', '卡通人物仍进入了强制两色通道');
  const pattern = mapPixels(sample.data, sample.width, sample.height, palette, {
    ...options('compact', 52, sample.sourceKind),
    sourceKind: sample.sourceKind
  });
  assert(codes(pattern).size > 2, '卡通人物的肤色和服饰仍被压成两色');
});

// 已有封闭外框时，框内白底无法被边缘洪泛删除，但它也不应再次触发人物
// 内部描边。外框保持黑色，深蓝制服继续使用蓝色色号而不是整片 H7。
regression('已有外围黑框时不再给内部深色人物二次描边', () => {
  const size = 52, data = canvas(size, size);
  rectangle(data, size, 2, 2, 49, 2, [3, 3, 3]);
  rectangle(data, size, 2, 49, 49, 49, [3, 3, 3]);
  rectangle(data, size, 2, 2, 2, 49, [3, 3, 3]);
  rectangle(data, size, 49, 2, 49, 49, [3, 3, 3]);
  rectangle(data, size, 19, 9, 32, 17, [35, 50, 136]);
  rectangle(data, size, 16, 18, 35, 45, [38, 54, 145]);
  rectangle(data, size, 21, 12, 30, 21, [240, 176, 142]);
  rectangle(data, size, 18, 32, 33, 35, [220, 172, 48]);
  const pattern = mapPixels(data, size, size, palette, {
    ...options('compact', size, 'illustration'),
    localBackground: true,
    backgroundMode: 'subject',
    outlineMode: 'auto',
    blackBoundary: true,
    ensureClosedBoundary: true
  });
  assert(pattern[2][20] && pattern[2][20][0] === 'H7', '原图已有外围黑框没有保留');
  assert(pattern[28][25] && pattern[28][25][0] !== 'H7', '深蓝制服仍被二次描边吞成纯黑');
  const blackRatio = count(pattern, color => color && color[0] === 'H7') / count(pattern);
  assert(blackRatio < .22, `已有外框场景黑色占比仍异常：${blackRatio.toFixed(3)}`);
});

// 即使输入图没有外框，只要本次选择了独立挂件强包边，内部自动描边也必须
// 关闭：外圈变黑保证结构，内部深蓝仍保持蓝色，不能做两遍包边。
regression('生成外围强包边时不再给内部深色区域二次描边', () => {
  const size = 52, data = canvas(size, size);
  rectangle(data, size, 16, 8, 35, 45, [38, 54, 145]);
  rectangle(data, size, 21, 11, 30, 20, [240, 176, 142]);
  rectangle(data, size, 18, 31, 33, 34, [220, 172, 48]);
  const pattern = mapPixels(data, size, size, palette, {
    ...options('compact', size, 'illustration'),
    localBackground: true,
    backgroundMode: 'subject',
    outlineMode: 'auto',
    blackBoundary: true,
    ensureClosedBoundary: true
  });
  assert(pattern[28][16] && pattern[28][16][0] === 'H7', '独立挂件最外围没有形成黑色包边');
  assert(pattern[28][25] && pattern[28][25][0] !== 'H7', '已有外围强包边时内部深蓝仍被染黑');
});

// 深色衣服中的浅灰、浅紫反光不能因为“被暗色包围”就升级为纯白 H2；
// 真正接近纯白的眼睛高光和大块白衬衣仍需保留。
regression('清理深色人物内部伪白块与白色碎点并保留真白', () => {
  const size = 32, data = canvas(size, size);
  rectangle(data, size, 5, 4, 26, 28, [44, 55, 82]);
  rectangle(data, size, 13, 8, 18, 13, [247, 245, 240]);     // 真白衬衣
  setPixel(data, size, 9, 18, [211, 202, 220]);               // 浅紫反光
  setPixel(data, size, 22, 21, [222, 218, 224]);              // 浅灰反光
  rectangle(data, size, 10, 5, 12, 7, [12, 12, 15]);
  setPixel(data, size, 11, 6, [252, 252, 250]);               // 真眼睛高光
  const pattern = mapPixels(data, size, size, palette, {
    ...options('compact', size, 'illustration'),
    localBackground: true,
    backgroundMode: 'subject',
    blackBoundary: true
  });
  assert(pattern[18][9] && pattern[18][9][0] !== 'H2', '浅紫衣服反光仍被强制成纯白');
  assert(pattern[21][22] && pattern[21][22][0] !== 'H2', '浅灰衣服反光仍被强制成纯白');
  assert(pattern[10][15] && beadLightness(pattern[10][15]) >= 235, '白衬衣被错误清除或压暗');
  assert(pattern[6][11] && pattern[6][11][0] === 'H2', '真正眼睛高光被错误清除');
});

regression('52 格多色插画使用全局十二色预算', () => {
  const size = 52, data = canvas(size, size);
  rectangle(data, size, 4, 4, 47, 47, [0, 0, 0]);
  const colors = [
    [250, 175, 85], [225, 90, 35], [248, 215, 55], [205, 225, 90],
    [85, 195, 95], [50, 170, 145], [45, 185, 205], [55, 125, 220],
    [75, 75, 190], [140, 85, 205], [205, 90, 190], [240, 115, 160],
    [245, 185, 175], [215, 160, 120], [160, 120, 90], [115, 85, 65],
    [235, 235, 230], [195, 200, 205], [130, 135, 145], [65, 65, 75]
  ];
  colors.forEach((color, index) => {
    const column = index % 5, row = Math.floor(index / 5);
    const x0 = 5 + column * 8, y0 = 5 + row * 10;
    rectangle(data, size, x0, y0, x0 + 7, y0 + 9, color);
  });
  const rich = mapPixels(data, size, size, palette, options('rich', size));
  const compact = mapPixels(data, size, size, palette, options('compact', size));
  assertSameOccupancyMask(compact, rich, '52 多色全局预算');
  assert(codes(rich).size > 12, '多色测试图没有形成足够丰富的基线');
  assert(codes(compact).size <= 12, '52 格插画减少模式超过十二色预算');
  assert(codes(compact).has('H7'), '全局限色丢失黑色结构');
  const compactColors = [...codes(compact)].map(code => palette.find(color => color[0] === code)).filter(Boolean);
  const families = new Set(compactColors.filter(color => Math.hypot(...rgbToLab([color[2], color[3], color[4]]).slice(1)) > 18).map(hueFamily));
  assert(families.size >= 5, '全局限色吞掉了过多主色系');
});

console.log(JSON.stringify({ ok: regressionFailures.length === 0, report, regressionFailures }, null, 2));
if (regressionFailures.length) process.exitCode = 1;
