let PDFDocument = null;
const { brands, getPalette, getPackageOptions } = require('../../utils/beadPalettes');
const { clamp, nearest, preparePalette, mapPixels, prepareSubjectSample, recount } = require('../../utils/beadEngine');
const {
  createQuadMapper, validateReferenceQuad,
  inferGridFromReference, fitGridGeometry, stabilizeNeutralCells, recognizeChart
} = require('../../utils/chartRecognizer');
const history = require('../../utils/beadHistory');
const { queryCanvas, loadCanvasImage, canvasToFile } = require('../../utils/canvas');
const { saveImage, readArrayBuffer, writeUserFile, copyFile, shareFile, openDocument, cacheImageForProcessing, removeLocalFile } = require('../../utils/files');
const { uploadTemporary, downloadTemporary, callTool, cleanup } = require('../../utils/cloud');
const { createRewardedGate, runLocalWithQuota, runServerWithQuota, isRewardCancellation } = require('../../utils/rewardedAccess');
const { createQr } = require('../../utils/qrcode');

const STAGE_TITLES = {
  home: '拼豆创作', crop: '裁切照片', style: '选择风格', aiResult: '风格转换结果',
  settings: '图纸设置', editor: '拼豆图纸', qr: '二维码拼豆',
  drawSetup: '创建空白图纸', draw: '自由绘制', pixelSetup: '图纸识别'
};
const APP_NAME = '智百宝箱-拼豆';
const SEARCH_KEYWORD = '智百宝箱';
const OFFICIAL_URL = 'https://samvibe.top';
const MINI_PROGRAM_CODE_PATH = '/assets/brand/miniprogram-code.png';
// Only newly generated canvases use this limit. Imported chart recognition keeps
// using the complete-cell range inferred from the source image without a fixed cap.
const GENERATED_PATTERN_MAX_SIDE = 240;
const SIZE_PRESETS = [
  { value: 32, label: '迷你', detail: '32 × 32' },
  { value: 52, label: '标准小板', detail: '52 × 52' },
  { value: 78, label: '中板', detail: '78 × 78' },
  { value: 104, label: '超大板', detail: '104 × 104' }
];
const CROP_RATIOS = [
  { value: 'free', label: '自由' }, { value: 'original', label: '原图' },
  { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' }, { value: '4:3', label: '4:3' }
];
const PEOPLE_IDENTITY_LOCK = '严格保留原图中实际佩戴和穿着的身份特征：帽子、头盔、发饰、眼镜、制服、肩章、领章、徽章、领带、腰带及手持道具都不得删除、替换或改成普通服装；帽檐、帽徽和制服识别色在缩到52×52后仍要清楚';
const AI_STYLES = [
  { value: 'big-head', label: '大头Q版', sheet: 1, people: true, prompt: `${PEOPLE_IDENTITY_LOCK}；按所选人物数量生成脸颊圆润、表情灵动的大头Q版平滑卡通插画；头部变大时帽子必须随头部同比例完整保留，不能改画成头发；每个人的眼睛、眉毛、鼻子、嘴巴和眼镜都要独立清楚，缩到52×52仍可见；使用清楚的大形状和三至五层卡通明暗，不保留写实毛发、皮肤纹理或细碎褶皱；原图各主要色块保持同一色相，只在原色基础上增加鲜艳度和层次` },
  { value: 'mini', label: '小图Q版', sheet: 2, people: true, prompt: `${PEOPLE_IDENTITY_LOCK}；按所选人物数量生成紧凑构图、清楚轮廓、较大五官的可爱全彩Q版平滑插画；每张脸都保留眼睛、眉毛、鼻子和嘴巴；用大形状和少量卡通明暗表达结构，不保留摄影纹理；颜色仍然艳丽丰富，不提前减少主色数量` },
  { value: 'pixel', label: '简约Q版', sheet: 3, people: true, prompt: `${PEOPLE_IDENTITY_LOCK}；按所选人物数量生成比例克制、线条干净、形状简练、色彩艳丽的简约Q版平滑插画；每张脸的眼睛、鼻子和嘴巴必须独立可辨；每个部位采用清楚的大色面和三至五层明暗，不生成写实纹理、像素或拼豆质感` },
  { value: 'faithful', label: '高度还原', sheet: 4, people: true, prompt: `${PEOPLE_IDENTITY_LOCK}；按所选人物数量保持原图主体身份、完整轮廓、构图、动作、色块位置和原始色相，转换为比照片更可爱、更简洁的高清卡通插画；每个人的眼睛、眉毛、鼻子、嘴巴和眼镜必须完整清楚，毛发、皮肤、衣料和阴影归纳成连续大形状，颜色明亮鲜艳但不减少主要色系` },
  { value: 'comic', label: '漫画风', sheet: 5, people: true, prompt: `${PEOPLE_IDENTITY_LOCK}；按所选人物数量转换为通用原创漫画插画风，每张脸五官完整，使用干净线条、鲜艳块面和明确明暗，保留主体特征，不模仿具体艺术家或作品` },
  { value: 'storybook', label: '童话绘本', sheet: 6, people: true, prompt: `${PEOPLE_IDENTITY_LOCK}；按所选人物数量转换为温暖的原创童话绘本插画风，每张脸五官完整，采用圆润造型、明快色块和简洁背景，不模仿任何特定品牌角色` },
  { value: 'pet', label: '宠物Q版', sheet: 7, prompt: '将宠物转换为紧凑、圆润、非常可爱的Q版贴纸式全身形象；头部较大，短四肢与身体连成一个完整整体，眼睛、鼻子、嘴巴使用少量清楚形状；保留品种、毛色分区、耳形和尾巴等标志性特征，但删除逐根毛发、写实体积、渐变和细碎配饰，每块毛色只使用主色和最多一层简单明暗' },
  { value: 'object', label: '物体插画', sheet: 8, prompt: '将主体物体转换为清晰的原创平滑插画，保留结构和主要配色，减少细碎纹理，背景简洁' },
  { value: 'original', label: '使用原图', sheet: 0, prompt: '' }
];
const COMPOSITION_OPTIONS = [
  { value: 'scene', label: '不抠图', detail: '保留完整画面和背景' },
  { value: 'subject', label: '抠出主体', detail: '清除背景，制作主体挂件' }
];
const PEOPLE_COUNT_OPTIONS = [
  { value: 'single', label: '单人', detail: '只保留 1 个人' },
  { value: 'double', label: '双人', detail: '两张脸都完整' },
  { value: 'multiple', label: '多人', detail: '保留 3 人及以上' }
];
const HAIR_MODE_OPTIONS = [
  { value: 'strict', label: '严格保留', detail: '长短、直卷、刘海都不变' },
  { value: 'tidy', label: '轻微整理', detail: '只清理碎发，不重做发型' }
];
const DENOISE_OPTIONS = [
  { value: 'none', label: '无' }, { value: 'low', label: '轻度' }, { value: 'high', label: '强力' }
];
const FIT_OPTIONS = [
  { value: 'close', label: '更接近原图' }, { value: 'clear', label: '图案更清晰' }
];
const COLOR_PRESETS = [
  { value: 'original', label: '就按原图', detail: '颜色不变', brightness: 100, contrast: 100, saturation: 100 },
  { value: 'vivid', label: '鲜艳一点', detail: '颜色更活泼', brightness: 103, contrast: 112, saturation: 125 },
  { value: 'soft', label: '温柔淡彩', detail: '柔柔的浅色', brightness: 105, contrast: 88, saturation: 85 },
  { value: 'contrast', label: '轮廓清楚', detail: '深浅更分明', brightness: 100, contrast: 126, saturation: 108 },
  { value: 'muted', label: '清淡耐看', detail: '颜色更克制', brightness: 102, contrast: 102, saturation: 65 },
  { value: 'bright', label: '亮白通透', detail: '画面更明亮', brightness: 112, contrast: 96, saturation: 105 }
];
const COLOR_USAGE_OPTIONS = [
  { value: 'compact', label: '减少颜色', detail: '全局选择主色，减少零散材料' },
  { value: 'rich', label: '丰富颜色', detail: '保留更多层次，仍会清理近色碎点' }
];
const EDIT_TOOLS = [
  { value: 'paint', label: '画笔' }, { value: 'erase', label: '橡皮' }, { value: 'picker', label: '取色' }
];

function promisify(api, options) {
  return new Promise((resolve, reject) => api({ ...options, success: resolve, fail: reject }));
}
function formatDate(timestamp) {
  const date = new Date(timestamp); return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function normalizePatternName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function fitCanvasLines(ctx, value, maxWidth, maximumLines = 2) {
  const characters = Array.from(normalizePatternName(value));
  if (!characters.length) return [];
  const lines = [];
  let current = '';
  characters.forEach(character => {
    const candidate = current + character;
    if (current && ctx.measureText(candidate).width > maxWidth && lines.length < maximumLines - 1) {
      lines.push(current); current = character;
    } else current = candidate;
  });
  if (current) lines.push(current);
  if (lines.length > maximumLines) lines.length = maximumLines;
  const lastIndex = lines.length - 1;
  if (lastIndex >= 0 && ctx.measureText(lines[lastIndex]).width > maxWidth) {
    let line = lines[lastIndex];
    while (line.length && ctx.measureText(`${line}…`).width > maxWidth) line = line.slice(0, -1);
    lines[lastIndex] = `${line}…`;
  }
  return lines;
}
function historyTypeLabel(type) {
  return { ai: '风格图纸', photo: '照片图纸', qr: '二维码', draw: '自由绘制', pixel: '像素图', chart: '识别图纸' }[type] || '拼豆图纸';
}
function luminance(color) { return color[2] * .299 + color[3] * .587 + color[4] * .114; }
function inferQrGridGeometry(pattern) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < pattern.length; y += 1) for (let x = 0; x < pattern[y].length; x += 1) {
    const color = pattern[y][x];
    if (!color || luminance(color) >= 142) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) return null;
  const spanX = maxX - minX + 1, spanY = maxY - minY + 1;
  for (let moduleCount = 21; moduleCount <= 177; moduleCount += 4) {
    const scale = spanX / moduleCount;
    if (Number.isInteger(scale) && scale >= 1 && spanY === moduleCount * scale) {
      return { minX, minY, maxX, maxY, moduleCount, scale, version: (moduleCount - 17) / 4 };
    }
  }
  return null;
}
function qrAlignmentCenters(geometry) {
  if (!geometry || geometry.version <= 1) return [];
  const count = Math.floor(geometry.version / 7) + 2;
  const step = geometry.version === 32
    ? 26
    : Math.floor((geometry.version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const centers = [6];
  for (let index = count - 1, position = geometry.moduleCount - 7; index >= 1; index -= 1, position -= step) centers[index] = position;
  return centers;
}
function isQrFunctionCell(x, y, geometry) {
  if (!geometry || x < geometry.minX || y < geometry.minY || x > geometry.maxX || y > geometry.maxY) return false;
  const moduleX = Math.floor((x - geometry.minX) / geometry.scale);
  const moduleY = Math.floor((y - geometry.minY) / geometry.scale);
  const last = geometry.moduleCount - 1;
  if ((moduleX <= 8 && moduleY <= 8)
    || (moduleX >= last - 8 && moduleY <= 8)
    || (moduleX <= 8 && moduleY >= last - 8)
    || moduleX === 6 || moduleY === 6 || moduleX === 8 || moduleY === 8) return true;
  if (geometry.version >= 7
    && ((moduleX >= last - 10 && moduleX <= last - 8 && moduleY <= 5)
      || (moduleY >= last - 10 && moduleY <= last - 8 && moduleX <= 5))) return true;
  const centers = qrAlignmentCenters(geometry);
  for (let row = 0; row < centers.length; row += 1) for (let col = 0; col < centers.length; col += 1) {
    const centerX = centers[col], centerY = centers[row];
    const overlapsFinder = (centerX === 6 && centerY === 6)
      || (centerX === 6 && centerY === last - 6)
      || (centerX === last - 6 && centerY === 6);
    if (!overlapsFinder && Math.abs(moduleX - centerX) <= 2 && Math.abs(moduleY - centerY) <= 2) return true;
  }
  return false;
}
function extractColorAnchors(context, width, height, subjectOnly = false) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 96));
  const bins = new Map(), edgeBins = new Map();
  const edgeBand = Math.max(step * 3, Math.round(Math.min(width, height) * .07));
  const keyFor = (r, g, b) => `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
  const record = (map, r, g, b, center = false) => {
    const key = keyFor(r, g, b), item = map.get(key) || { count: 0, centerCount: 0, r: 0, g: 0, b: 0 };
    item.count += 1; item.centerCount += center ? 1 : 0; item.r += r; item.g += g; item.b += b; map.set(key, item);
  };
  let imageData;
  try { imageData = context.getImageData(0, 0, width, height).data; } catch (_) { return []; }
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const index = (y * width + x) * 4;
    if (imageData[index + 3] < 24) continue;
    const r = imageData[index], g = imageData[index + 1], b = imageData[index + 2];
    const nx = (x - width * .5) / Math.max(1, width * .42), ny = (y - height * .47) / Math.max(1, height * .44);
    const center = nx * nx + ny * ny <= 1;
    record(bins, r, g, b, center);
    if (x < edgeBand || y < edgeBand || x >= width - edgeBand || y >= height - edgeBand) record(edgeBins, r, g, b);
  }
  const edgeTotal = Array.from(edgeBins.values()).reduce((sum, item) => sum + item.count, 0);
  const dominantEdge = Array.from(edgeBins.entries()).sort((a, b) => b[1].count - a[1].count)[0];
  const backgroundKey = dominantEdge && dominantEdge[1].count / Math.max(1, edgeTotal) >= .34 ? dominantEdge[0] : '';
  const significantEdgeColors = Array.from(edgeBins.values()).filter(item => item.count / Math.max(1, edgeTotal) >= .012).length;
  // 复杂摄影场景的边缘包含大量天空、树木、草地和灯光颜色。没有可靠分割前，
  // 把这些颜色作为“主体锚点”会与仅主体指令直接冲突；此时宁可让模型依据原图
  // 识别主体本身，也不发送一组被背景污染的颜色清单。
  if (subjectOnly && significantEdgeColors >= 10) return [];
  const candidates = Array.from(bins.entries()).filter(([key, item]) => {
    if (key === backgroundKey) return false;
    if (!subjectOnly) return true;
    const edge = edgeBins.get(key), edgeRatio = (edge ? edge.count : 0) / Math.max(1, item.count);
    // “仅主体”时，整圈边缘反复出现的颜色通常属于天空、草地、墙面或摄影
    // 背景，不能再作为主色锚点反过来要求模型保留场景。主体触碰边缘时仍可
    // 依靠中心采样保留，所以这里只排除边缘占比高且中心占比低的色桶。
    return item.centerCount > 0 && !(edgeRatio >= .18 && item.centerCount / item.count < .58);
  }).map(([, item]) => {
    const rgb = [item.r / item.count, item.g / item.count, item.b / item.count];
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    const baseCount = subjectOnly ? item.centerCount * 2.4 + Math.min(item.count, item.centerCount * 1.4) : item.count;
    return { rgb, count: item.count, score: baseCount * (1 + Math.min(.55, chroma / 210)) };
  }).sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    if (candidate.count < 2) continue;
    const distinct = selected.every(item => {
      const dr = item.rgb[0] - candidate.rgb[0], dg = item.rgb[1] - candidate.rgb[1], db = item.rgb[2] - candidate.rgb[2];
      return dr * dr + dg * dg + db * db >= 34 * 34;
    });
    if (distinct) selected.push(candidate);
    if (selected.length >= 8) break;
  }
  return selected.map(item => `#${item.rgb.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`);
}

Page({
  data: {
    stage: 'home', sourcePath: '', originalPath: '', generatedPath: '', sourceAspect: 1,
    cropRatios: CROP_RATIOS, cropRatio: 'original', cropBusy: false,
    cropFrameScale: 82, cropFreeRatio: 100, cropZoom: 100,
    cropFrameStyle: 'width:82%;height:82%;left:9%;top:9%;', cropFrameRatioText: '原图比例',
    aiStyles: AI_STYLES, styleIndex: 0, customRequest: '', peopleCountOptions: PEOPLE_COUNT_OPTIONS, peopleCountMode: 'single', hairModeOptions: HAIR_MODE_OPTIONS, hairMode: 'strict', compositionOptions: COMPOSITION_OPTIONS, compositionMode: 'subject', uploadConsent: false, aiBusy: false,
    aiStatus: '', aiStatusType: '', aiGenerated: false, aiProgress: 0, aiElapsedText: '',
    sizePresets: SIZE_PRESETS, longSide: 52, resultWidth: 52, resultHeight: 52, physicalSizeText: '约 26 × 26 厘米',
    brands, brandIndex: 0, packageOptions: getPackageOptions('mard'), packageIndex: getPackageOptions('mard').length - 1,
    colorPresets: COLOR_PRESETS, colorPresetIndex: 0, colorUsageOptions: COLOR_USAGE_OPTIONS, colorUsageMode: 'compact',
    brightness: 100, contrast: 100, saturation: 100, denoiseOptions: DENOISE_OPTIONS, denoiseIndex: 0,
    removeNoise: false, smoothEdges: false, localBackground: true, removeBackground: false, cutoutConsent: false,
    fitOptions: FIT_OPTIONS, fitIndex: 0, gridBold: false,
    busy: false, progress: 0, status: '', statusType: '', patternReady: false,
    previewPath: '', totalBeads: 0, materials: [],
    editTools: EDIT_TOOLS, editTool: 'paint', paletteOpen: false, paletteColors: [], selectedColorIndex: 0,
    undoAvailable: false, redoAvailable: false, replaceFromIndex: 0, replaceToIndex: 0,
    qrContent: '', patternName: '', qrForegroundIndex: 0, qrBackgroundIndex: 0, qrSizeIndex: 1, qrStatus: '',
    qrSizeOptions: ['小（1x）', '中（2x）', '大（3x）', '特大（4x）'],
    historyItems: [], exportBusy: false, projectType: 'photo',
    settingsPreviewPath: '', settingsPreviewBusy: false, settingsPreviewTotal: 0, settingsPreviewColors: 0, settingsPreviewQrInfo: '',
    drawRows: 52, drawColumns: 52, drawBrandIndex: 0,
    drawPackageOptions: getPackageOptions('mard'), drawPackageIndex: getPackageOptions('mard').length - 1,
    drawReferencePath: '', drawReferenceOpacity: 28, drawMode: 'edit', drawTool: 'paint',
    drawSelectedColorIndex: 0, drawPaletteColors: [], drawUndoAvailable: false, drawRedoAvailable: false,
    drawLockedCount: 0, drawHint: '单指绘制，双指缩放与移动画布',
    pixelPath: '', pixelOriginalWidth: 0, pixelOriginalHeight: 0, pixelLongSide: 52,
    pixelWidth: 52, pixelHeight: 52, pixelBrandIndex: 0,
    pixelPackageOptions: getPackageOptions('mard'), pixelPackageIndex: getPackageOptions('mard').length - 1,
    pixelBusy: false, pixelStatus: '', chartColumns: 0, chartRows: 0,
    chartHint: '任选中间边线清楚的 2×2 四格，让粉色框外沿贴紧四格外边',
    chartCornerMode: 'rect', chartZoom: 100, chartAutoReady: false,
    chartMatchText: '等待框选 2×2 四格', chartMatchDetail: '粉色框内应正好是四个完整格子',
    patternScale: 1, patternZoom: 100, patternMoveX: 0, patternMoveY: 0,
    patternEditLocked: true, patternViewReady: true
  },

  onLoad() { const gate = createRewardedGate('beadAI'); this._aiRewardedGate = gate; this._localRewardedGate = gate; this._removeBackgroundGate = gate; this.refreshHistory(); },
  onReady() { this._pageReady = true; this.scheduleHistoryThumbnails(); },
  onShow() { if (this._pageReady) this.refreshHistory(); },
  onUnload() { if (this._aiRewardedGate) this._aiRewardedGate.destroy(); clearTimeout(this._settingsPreviewTimer); clearTimeout(this._historyThumbnailTimer); clearInterval(this._aiProgressTimer); this._settingsPreviewToken = 0; this._chartSample = null; this._chartGeometry = null; (this._importCachePaths || []).forEach(path => removeLocalFile(path)); },
  onShareAppMessage() { return { title: 'SamVibe 拼豆图纸', path: '/pages/beads/beads' }; },

  async cacheSelectedImage(path) {
    wx.showLoading({ title: '正在读取原图', mask: true });
    try {
      const cachedPath = await cacheImageForProcessing(path);
      this._importCachePaths = this._importCachePaths || [];
      this._importCachePaths.push(cachedPath);
      return cachedPath;
    } finally { wx.hideLoading(); }
  },

  setStage(stage) {
    this.setData({ stage, status: '', aiStatus: '', qrStatus: '' });
    wx.setNavigationBarTitle({ title: STAGE_TITLES[stage] || '拼豆创作' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  goHome() { this.setStage('home'); },
  scheduleHistoryThumbnails() {
    if (this._historyThumbnailsStarted) return;
    this._historyThumbnailsStarted = true;
    this._historyThumbnailTimer = setTimeout(() => this.ensureHistoryThumbnails(), 1000);
  },
  goBack() {
    if (this.data.aiBusy) return;
    if(this.data.stage==='pixelSetup'){this._chartSample=null;this._chartGeometry=null;}
    const previous = { crop: 'home', style: 'crop', aiResult: 'style', settings: this.data.aiGenerated ? 'aiResult' : 'style', editor: 'home', qr: 'home', drawSetup: 'home', draw: 'drawSetup', pixelSetup: 'home' };
    const target = previous[this.data.stage] || 'home'; this.setStage(target);
    if (target === 'crop') setTimeout(() => this.initCropper(false), 60);
  },

  startFreeDraw() {
    const options = getPackageOptions('mard');
    this.setData({ drawRows: 52, drawColumns: 52, drawBrandIndex: 0, drawPackageOptions: options, drawPackageIndex: options.length - 1, drawReferencePath: '' });
    this.setStage('drawSetup');
  },
  onDrawSize(event) {
    const key = event.currentTarget.dataset.key, raw = parseInt(event.detail.value, 10);
    const value = clamp(raw || 8, 8, GENERATED_PATTERN_MAX_SIDE);
    if (raw && raw !== value) wx.showToast({ title: `请输入 8–${GENERATED_PATTERN_MAX_SIDE}`, icon: 'none' });
    this.setData({ [key]: value });
  },
  chooseDrawPreset(event) { const value = Number(event.currentTarget.dataset.value); this.setData({ drawRows: value, drawColumns: value }); },
  onDrawBrand(event) {
    const index = Number(event.detail.value), options = getPackageOptions(brands[index].value);
    this.setData({ drawBrandIndex: index, drawPackageOptions: options, drawPackageIndex: options.length - 1 });
  },
  onDrawPackage(event) { this.setData({ drawPackageIndex: Number(event.detail.value) }); },
  async chooseDrawReference() {
    try {
      const result = await promisify(wx.chooseMedia, { count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] });
      const path = await this.cacheSelectedImage(result.tempFiles[0].tempFilePath);
      this.setData({ drawReferencePath: path });
    } catch (_) {}
  },
  onDrawReferenceOpacity(event) { this.setData({ drawReferenceOpacity: Number(event.detail.value) }); this.renderDrawCanvas(); },
  async createFreeDraw() {
    const brand = brands[this.data.drawBrandIndex], packageSize = this.data.drawPackageOptions[this.data.drawPackageIndex].value;
    this._palette = getPalette(brand.value, packageSize);
    this._pattern = Array.from({ length: this.data.drawRows }, () => Array(this.data.drawColumns).fill(null));
    this._locked = Array.from({ length: this.data.drawRows }, () => Array(this.data.drawColumns).fill(false));
    this._drawUndo = []; this._drawRedo = []; this._undo = []; this._redo = [];
    this.setData({ brandIndex: this.data.drawBrandIndex, packageOptions: this.data.drawPackageOptions, packageIndex: this.data.drawPackageIndex,
      drawPaletteColors: this.paletteView(this._palette), drawSelectedColorIndex: 0, drawMode: 'edit', drawTool: 'paint', drawLockedCount: 0,
      drawUndoAvailable: false, drawRedoAvailable: false, projectType: 'draw' });
    this.setStage('draw'); setTimeout(() => this.initDrawCanvas(), 80);
  },
  async initDrawCanvas() {
    try {
      const query = await queryCanvas(this, '#drawCanvas'), canvas = query.node;
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
      canvas.width = Math.round(query.width * dpr); canvas.height = Math.round(query.height * dpr);
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._drawCanvas = canvas; this._drawContext = ctx; this._drawViewport = { width: query.width, height: query.height };
      const cell = Math.min((query.width - 28) / this.data.drawColumns, (query.height - 28) / this.data.drawRows);
      this._drawView = { cell: Math.max(3, cell), x: (query.width - cell * this.data.drawColumns) / 2, y: (query.height - cell * this.data.drawRows) / 2 };
      if (this.data.drawReferencePath) this._drawReferenceImage = await loadCanvasImage(canvas, this.data.drawReferencePath);
      await this.renderDrawCanvas();
    } catch (_) { wx.showToast({ title: '绘图画布初始化失败', icon: 'none' }); }
  },
  renderDrawCanvas() {
    if (!this._drawContext || !this._pattern) return;
    const ctx = this._drawContext, view = this._drawView, vp = this._drawViewport, rows = this._pattern.length, cols = this._pattern[0].length;
    ctx.clearRect(0, 0, vp.width, vp.height); ctx.fillStyle = '#f3f2f7'; ctx.fillRect(0, 0, vp.width, vp.height);
    const gw = cols * view.cell, gh = rows * view.cell;
    ctx.save(); ctx.beginPath(); ctx.rect(view.x, view.y, gw, gh); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(view.x, view.y, gw, gh);
    if (this._drawReferenceImage) {
      ctx.globalAlpha = this.data.drawReferenceOpacity / 100;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(this._drawReferenceImage, view.x, view.y, gw, gh); ctx.globalAlpha = 1;
    }
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
      const color = this._pattern[y][x], px = view.x + x * view.cell, py = view.y + y * view.cell;
      if (color) { ctx.fillStyle = `rgb(${color[2]},${color[3]},${color[4]})`; ctx.fillRect(px, py, view.cell, view.cell); }
      if (this._locked[y][x]) { ctx.fillStyle = 'rgba(90,67,112,.24)'; ctx.fillRect(px, py, view.cell, view.cell); }
    }
    ctx.lineWidth = 1; ctx.strokeStyle = view.cell >= 8 ? 'rgba(92,92,110,.18)' : 'rgba(92,92,110,.1)';
    for (let x = 0; x <= cols; x += 1) { ctx.beginPath(); ctx.moveTo(view.x + x * view.cell, view.y); ctx.lineTo(view.x + x * view.cell, view.y + gh); ctx.stroke(); }
    for (let y = 0; y <= rows; y += 1) { ctx.beginPath(); ctx.moveTo(view.x, view.y + y * view.cell); ctx.lineTo(view.x + gw, view.y + y * view.cell); ctx.stroke(); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(219,104,151,.48)';
    for (let x = 10; x < cols; x += 10) { ctx.beginPath(); ctx.moveTo(view.x + x * view.cell, view.y); ctx.lineTo(view.x + x * view.cell, view.y + gh); ctx.stroke(); }
    for (let y = 10; y < rows; y += 10) { ctx.beginPath(); ctx.moveTo(view.x, view.y + y * view.cell); ctx.lineTo(view.x + gw, view.y + y * view.cell); ctx.stroke(); }
    if (this._lockPreview) { const a = this._lockPreview.a, b = this._lockPreview.b; ctx.strokeStyle = '#e26096'; ctx.lineWidth = 3; ctx.strokeRect(view.x + Math.min(a.x,b.x)*view.cell, view.y + Math.min(a.y,b.y)*view.cell, (Math.abs(a.x-b.x)+1)*view.cell, (Math.abs(a.y-b.y)+1)*view.cell); }
    ctx.restore();
  },
  drawCellAt(touch) {
    const view = this._drawView, x = Math.floor((touch.x - view.x) / view.cell), y = Math.floor((touch.y - view.y) / view.cell);
    if (!this._pattern || x < 0 || y < 0 || y >= this._pattern.length || x >= this._pattern[0].length) return null;
    return { x, y };
  },
  drawTouchStart(event) {
    if (event.touches.length >= 2) {
      const a = event.touches[0], b = event.touches[1];
      this._drawPinch = { distance: Math.hypot(a.x-b.x,a.y-b.y), cell: this._drawView.cell, x: this._drawView.x, y: this._drawView.y, centerX:(a.x+b.x)/2, centerY:(a.y+b.y)/2 }; return;
    }
    const cell = this.drawCellAt(event.touches[0]); if (!cell) return;
    this._drawStroke = { changes: [], last: cell };
    if (this.data.drawMode === 'lock') { this._lockPreview = { a: cell, b: cell }; this.renderDrawCanvas(); return; }
    this.applyDrawCell(cell.x, cell.y);
  },
  drawTouchMove(event) {
    if (event.touches.length >= 2 && this._drawPinch) {
      const a=event.touches[0], b=event.touches[1], centerX=(a.x+b.x)/2, centerY=(a.y+b.y)/2;
      const ratio=Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this._drawPinch.distance), cell=clamp(this._drawPinch.cell*ratio,3,48);
      const anchorX=(this._drawPinch.centerX-this._drawPinch.x)/this._drawPinch.cell, anchorY=(this._drawPinch.centerY-this._drawPinch.y)/this._drawPinch.cell;
      this._drawView={cell,x:centerX-anchorX*cell,y:centerY-anchorY*cell}; this.renderDrawCanvas(); return;
    }
    const cell=this.drawCellAt(event.touches[0]); if (!cell || !this._drawStroke) return;
    if (this.data.drawMode === 'lock') { this._lockPreview.b=cell; this.renderDrawCanvas(); return; }
    const last=this._drawStroke.last, steps=Math.max(Math.abs(cell.x-last.x),Math.abs(cell.y-last.y));
    for(let i=1;i<=Math.max(1,steps);i+=1) this.applyDrawCell(Math.round(last.x+(cell.x-last.x)*i/Math.max(1,steps)),Math.round(last.y+(cell.y-last.y)*i/Math.max(1,steps)),false);
    this._drawStroke.last=cell; this.renderDrawCanvas();
  },
  drawTouchEnd() {
    this._drawPinch=null;
    if (!this._drawStroke) return;
    if (this.data.drawMode === 'lock' && this._lockPreview) {
      const {a,b}=this._lockPreview, target=!this._locked[a.y][a.x], changes=[];
      for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y+=1) for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x+=1) if(this._locked[y][x]!==target){changes.push({kind:'lock',x,y,before:this._locked[y][x],after:target});this._locked[y][x]=target;}
      this._drawStroke.changes.push(...changes); this._lockPreview=null;
    }
    if(this._drawStroke.changes.length){this._drawUndo.push(this._drawStroke.changes);this._drawRedo=[];}
    this._drawStroke=null; this.updateDrawState(); this.renderDrawCanvas();
  },
  applyDrawCell(x,y,render=true) {
    if(this._locked[y][x]) return;
    if(this.data.drawTool==='fill'){this.fillDrawArea(x,y);return;}
    if(this.data.drawTool==='picker'){const color=this._pattern[y][x];if(color){const index=this._palette.findIndex(c=>c[0]===color[0]);this.setData({drawSelectedColorIndex:Math.max(0,index),drawTool:'paint'});}return;}
    const before=this._pattern[y][x],after=this.data.drawTool==='erase'?null:this._palette[this.data.drawSelectedColorIndex];
    if((before&&after&&before[0]===after[0])||(!before&&!after))return;
    this._pattern[y][x]=after;this._drawStroke.changes.push({kind:'cell',x,y,before,after});if(render)this.renderDrawCanvas();
  },
  fillDrawArea(x,y){
    const before=this._pattern[y][x],after=this._palette[this.data.drawSelectedColorIndex];if(before&&before[0]===after[0])return;
    const code=before?before[0]:'',queue=[[x,y]],seen={};while(queue.length){const [cx,cy]=queue.pop(),key=`${cx},${cy}`;if(seen[key]||cx<0||cy<0||cy>=this._pattern.length||cx>=this._pattern[0].length||this._locked[cy][cx])continue;seen[key]=1;const cur=this._pattern[cy][cx];if((cur?cur[0]:'')!==code)continue;this._pattern[cy][cx]=after;this._drawStroke.changes.push({kind:'cell',x:cx,y:cy,before:cur,after});queue.push([cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]);}this.renderDrawCanvas();
  },
  selectDrawMode(event){this.setData({drawMode:event.currentTarget.dataset.value,drawHint:event.currentTarget.dataset.value==='lock'?'拖动选择区域：未锁定区域会锁定，已锁定区域会解锁':'单指绘制，双指缩放与移动画布'});},
  selectDrawTool(event){this.setData({drawTool:event.currentTarget.dataset.value,drawMode:'edit'});},
  selectDrawColor(event){this.setData({drawSelectedColorIndex:Number(event.currentTarget.dataset.index),drawTool:'paint',drawMode:'edit'});},
  updateDrawState(){let locked=0;this._locked.forEach(r=>r.forEach(v=>{if(v)locked+=1;}));this.setData({drawLockedCount:locked,drawUndoAvailable:this._drawUndo.length>0,drawRedoAvailable:this._drawRedo.length>0});},
  applyDrawHistory(changes,reverse){changes.forEach(c=>{if(c.kind==='lock')this._locked[c.y][c.x]=reverse?c.before:c.after;else this._pattern[c.y][c.x]=reverse?c.before:c.after;});this.updateDrawState();this.renderDrawCanvas();},
  undoDraw(){const c=this._drawUndo.pop();if(!c)return;this.applyDrawHistory(c,true);this._drawRedo.push(c);this.updateDrawState();},
  redoDraw(){const c=this._drawRedo.pop();if(!c)return;this.applyDrawHistory(c,false);this._drawUndo.push(c);this.updateDrawState();},
  async finishFreeDraw(){await this.renderPattern();this.setData({paletteColors:this.paletteView(this._palette),selectedColorIndex:this.data.drawSelectedColorIndex,patternReady:true,projectType:'draw',status:`自由图纸已完成，${this.data.drawLockedCount} 格已锁定。`,statusType:'success'});await this.saveCurrentProject('自由绘制图纸','draw');this.setStage('editor');},

  async startPixelImport() {
    try {
      const result=await promisify(wx.chooseMedia,{count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['original']}),path=await this.cacheSelectedImage(result.tempFiles[0].tempFilePath);
      const info=await promisify(wx.getImageInfo,{src:path});
      const options=getPackageOptions('mard');
      this._chartSample=null;this._chartGeometry=null;this._chartManualSize=false;
      this.setData({
        pixelPath:path,pixelOriginalWidth:info.width,pixelOriginalHeight:info.height,
        pixelBrandIndex:0,pixelPackageOptions:options,pixelPackageIndex:options.length-1,
        pixelStatus:'',chartColumns:0,chartRows:0,chartCornerMode:'rect',chartZoom:100,
        chartAutoReady:false,chartMatchText:'等待框选 2×2 四格',
        chartMatchDetail:'粉色框内应正好是四个完整格子',
        chartHint:'任选中间边线清楚的 2×2 四格，让粉色框外沿贴紧四格外边'
      });
      this.setStage('pixelSetup'); setTimeout(()=>this.initChartCanvas(),80);
    } catch(error){if(!/cancel/i.test(error.errMsg||''))wx.showToast({title:'图纸读取失败',icon:'none'});}
  },
  async initChartCanvas(){
    try{
      const query=await queryCanvas(this,'#chartCanvas'),canvas=query.node,image=await loadCanvasImage(canvas,this.data.pixelPath);
      const dpr=wx.getWindowInfo?wx.getWindowInfo().pixelRatio:wx.getSystemInfoSync().pixelRatio;
      canvas.width=Math.round(query.width*dpr);canvas.height=Math.round(query.height*dpr);
      const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
      const scale=Math.min(query.width/image.width,query.height/image.height),width=image.width*scale,height=image.height*scale;
      this._chartCanvas=canvas;this._chartContext=ctx;this._chartImage=image;this._chartViewport={width:query.width,height:query.height};
      this._chartImageBox={x:(query.width-width)/2,y:(query.height-height)/2,width,height};
      const box=this._chartImageBox,referenceSize=Math.max(48,Math.min(box.width,box.height)*.2),centerX=box.x+box.width/2,centerY=box.y+box.height/2;
      this._chartPoints=[
        {x:centerX-referenceSize/2,y:centerY-referenceSize/2},
        {x:centerX+referenceSize/2,y:centerY-referenceSize/2},
        {x:centerX+referenceSize/2,y:centerY+referenceSize/2},
        {x:centerX-referenceSize/2,y:centerY+referenceSize/2}
      ];
      this._chartBaseScale=scale;
      this._chartGeometry=null;this._chartManualSize=false;
      this.setData({
        chartZoom:100,chartColumns:0,chartRows:0,chartAutoReady:false,
        chartMatchText:'等待框选 2×2 四格',chartMatchDetail:'拖动四个粉色角点完成校准'
      });
      this.drawChartCanvas();
      await this.prepareChartSampleData();
    }catch(error){this.setData({pixelStatus:'图纸校正画布初始化失败，请重新选择图片。'});}
  },
  async prepareChartSampleData(){
    if(this._chartSample&&this._chartSample.path===this.data.pixelPath)return this._chartSample;
    const query=await queryCanvas(this,'#sampleCanvas'),canvas=query.node,image=await loadCanvasImage(canvas,this.data.pixelPath);
    const maxSide=4096,maxPixels=10000000;
    const scale=Math.min(1,maxSide/Math.max(image.width,image.height),Math.sqrt(maxPixels/(image.width*image.height)));
    const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,width,height);
    this._chartSample={path:this.data.pixelPath,width,height,data:ctx.getImageData(0,0,width,height).data};
    return this._chartSample;
  },
  chartReferenceInSample(sample){
    const box=this._chartImageBox;
    return this._chartPoints.map(point=>({x:(point.x-box.x)/box.width*sample.width,y:(point.y-box.y)/box.height*sample.height}));
  },
  chartSamplePointToView(point,sample){
    const box=this._chartImageBox;
    return{x:box.x+point.x/sample.width*box.width,y:box.y+point.y/sample.height*box.height};
  },
  currentChartGeometry(){
    if(!this._chartGeometry)return null;
    if(!this._chartManualSize)return this._chartGeometry;
    return fitGridGeometry(this._chartGeometry,this.data.chartColumns,this.data.chartRows);
  },
  async refreshChartMatch(){
    try{
      const sample=await this.prepareChartSampleData(),reference=this.chartReferenceInSample(sample);
      const geometry=inferGridFromReference(sample.data,sample.width,sample.height,reference);
      this._chartGeometry=geometry;this._chartManualSize=false;
      const detail=geometry.estimated
        ?'局部格线较淡，已按框选格距扩展到图片内的完整格；请检查绿色范围'
        :geometry.confidence<.45?'已按框选四格匹配，建议放大检查绿色线是否逐格重合':'框选四格已作为基准，绿色范围就是最终取色范围';
      this.setData({
        chartColumns:geometry.columns,chartRows:geometry.rows,chartAutoReady:true,
        chartMatchText:`已自动匹配 ${geometry.columns} × ${geometry.rows} 格`,
        chartMatchDetail:detail,pixelStatus:''
      },()=>this.drawChartCanvas());
      return geometry;
    }catch(error){
      this._chartGeometry=null;this._chartManualSize=false;
      this.setData({
        chartAutoReady:false,chartColumns:0,chartRows:0,
        chartMatchText:'暂未匹配到完整网格',
        chartMatchDetail:error.message||'请重新框选中间边线清楚的四格'
      },()=>this.drawChartCanvas());
      return null;
    }
  },
  drawChartCanvas(){
    if(!this._chartContext||!this._chartImage||!this._chartPoints)return;
    const ctx=this._chartContext,vp=this._chartViewport,box=this._chartImageBox,points=this._chartPoints;
    ctx.clearRect(0,0,vp.width,vp.height);ctx.fillStyle='#eeeaf3';ctx.fillRect(0,0,vp.width,vp.height);ctx.drawImage(this._chartImage,box.x,box.y,box.width,box.height);
    const sample=this._chartSample,geometry=this.currentChartGeometry();
    if(sample&&geometry){
      const bounds=geometry.contentBounds||{left:0,top:0,right:sample.width,bottom:sample.height};
      const at=(column,row)=>{
        const point=geometry.pointAt(column,row);
        return this.chartSamplePointToView({
          x:clamp(point.x,bounds.left,bounds.right),
          y:clamp(point.y,bounds.top,bounds.bottom)
        },sample);
      };
      const startColumn=geometry.startColumn,endColumn=geometry.endColumn,startRow=geometry.startRow,endRow=geometry.endRow;
      const boundary=[at(startColumn,startRow),at(endColumn,startRow),at(endColumn,endRow),at(startColumn,endRow)];
      ctx.save();ctx.fillStyle='rgba(110,224,194,.08)';ctx.beginPath();ctx.moveTo(boundary[0].x,boundary[0].y);boundary.slice(1).forEach(point=>ctx.lineTo(point.x,point.y));ctx.closePath();ctx.fill();
      const columnStep=Math.max(1,Math.ceil(geometry.columns/72)),rowStep=Math.max(1,Math.ceil(geometry.rows/72));
      ctx.lineWidth=1;ctx.strokeStyle='rgba(82,190,162,.62)';
      for(let column=startColumn;column<=endColumn;column+=columnStep){const top=at(column,startRow),bottom=at(column,endRow);ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.lineTo(bottom.x,bottom.y);ctx.stroke();}
      if((endColumn-startColumn)%columnStep!==0){const top=at(endColumn,startRow),bottom=at(endColumn,endRow);ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.lineTo(bottom.x,bottom.y);ctx.stroke();}
      for(let row=startRow;row<=endRow;row+=rowStep){const left=at(startColumn,row),right=at(endColumn,row);ctx.beginPath();ctx.moveTo(left.x,left.y);ctx.lineTo(right.x,right.y);ctx.stroke();}
      if((endRow-startRow)%rowStep!==0){const left=at(startColumn,endRow),right=at(endColumn,endRow);ctx.beginPath();ctx.moveTo(left.x,left.y);ctx.lineTo(right.x,right.y);ctx.stroke();}
      ctx.lineWidth=3;ctx.strokeStyle='#65d8ba';ctx.beginPath();ctx.moveTo(boundary[0].x,boundary[0].y);boundary.slice(1).forEach(point=>ctx.lineTo(point.x,point.y));ctx.closePath();ctx.stroke();ctx.restore();
    }
    const map=createQuadMapper(points);
    ctx.save();ctx.fillStyle='rgba(255,143,183,.11)';ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);points.slice(1).forEach(point=>ctx.lineTo(point.x,point.y));ctx.closePath();ctx.fill();
    ctx.lineWidth=2;ctx.strokeStyle='rgba(255,255,255,.95)';
    const verticalTop=map(.5,0),verticalBottom=map(.5,1),horizontalLeft=map(0,.5),horizontalRight=map(1,.5);
    ctx.beginPath();ctx.moveTo(verticalTop.x,verticalTop.y);ctx.lineTo(verticalBottom.x,verticalBottom.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(horizontalLeft.x,horizontalLeft.y);ctx.lineTo(horizontalRight.x,horizontalRight.y);ctx.stroke();
    [[.25,.25,'1'],[.75,.25,'2'],[.25,.75,'3'],[.75,.75,'4']].forEach(item=>{const point=map(item[0],item[1]);ctx.beginPath();ctx.fillStyle='rgba(255,255,255,.9)';ctx.arc(point.x,point.y,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d96796';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(item[2],point.x,point.y);});
    ctx.lineWidth=3;ctx.strokeStyle='#ff8fb7';ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);points.slice(1).forEach(point=>ctx.lineTo(point.x,point.y));ctx.closePath();ctx.stroke();ctx.restore();
    points.forEach(point=>{ctx.beginPath();ctx.fillStyle='#ff8fb7';ctx.arc(point.x,point.y,12,0,Math.PI*2);ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();});
  },
  chartTouchPoint(touch){return{x:touch.x==null?(touch.clientX==null?touch.pageX:touch.clientX):touch.x,y:touch.y==null?(touch.clientY==null?touch.pageY:touch.clientY):touch.y};},
  chartTouchStart(event){
    const touches=event.touches||[];if(!touches.length||!this._chartPoints)return;
    if(touches.length>=2){const a=this.chartTouchPoint(touches[0]),b=this.chartTouchPoint(touches[1]);this._chartGesture={type:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},box:{...this._chartImageBox},points:this._chartPoints.map(point=>({...point}))};return;}
    const point=this.chartTouchPoint(touches[0]);let nearestIndex=0,distance=Infinity;this._chartPoints.forEach((item,index)=>{const current=Math.hypot(item.x-point.x,item.y-point.y);if(current<distance){distance=current;nearestIndex=index;}});
    this._chartGesture=distance<=48?{type:'handle',index:nearestIndex}:{type:'pan',point,box:{...this._chartImageBox},points:this._chartPoints.map(item=>({...item}))};
  },
  chartTouchMove(event){
    const touches=event.touches||[],gesture=this._chartGesture;if(!touches.length||!gesture)return;
    if(touches.length>=2&&gesture.type==='pinch'){
      const a=this.chartTouchPoint(touches[0]),b=this.chartTouchPoint(touches[1]),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const raw=Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance,current=gesture.box.width/Math.max(1,this._chartImage.width),minimum=this._chartBaseScale,maximum=minimum*12;
      const factor=clamp(current*raw,minimum,maximum)/current;
      const transform=point=>({x:mid.x+(point.x-gesture.mid.x)*factor,y:mid.y+(point.y-gesture.mid.y)*factor});
      const topLeft=transform({x:gesture.box.x,y:gesture.box.y});this._chartImageBox={x:topLeft.x,y:topLeft.y,width:gesture.box.width*factor,height:gesture.box.height*factor};this._chartPoints=gesture.points.map(transform);
      this.setData({chartZoom:Math.round(this._chartImageBox.width/Math.max(1,this._chartImage.width)/minimum*100)});this.drawChartCanvas();return;
    }
    const point=this.chartTouchPoint(touches[0]);
    if(gesture.type==='pan'){const dx=point.x-gesture.point.x,dy=point.y-gesture.point.y;this._chartImageBox={...gesture.box,x:gesture.box.x+dx,y:gesture.box.y+dy};this._chartPoints=gesture.points.map(item=>({x:item.x+dx,y:item.y+dy}));this.drawChartCanvas();return;}
    if(gesture.type!=='handle')return;
    if(!gesture.changed){
      gesture.changed=true;this._chartGeometry=null;this._chartManualSize=false;
      this.setData({chartAutoReady:false,chartMatchText:'正在调整四格参考框',chartMatchDetail:'松手后会自动匹配整张网格'});
    }
    const index=gesture.index,box=this._chartImageBox;let next={x:clamp(point.x,box.x,box.x+box.width),y:clamp(point.y,box.y,box.y+box.height)};
    if(this.data.chartCornerMode==='rect'){
      if(index===0)next={x:Math.min(next.x,this._chartPoints[2].x-20),y:Math.min(next.y,this._chartPoints[2].y-20)};
      else if(index===1)next={x:Math.max(next.x,this._chartPoints[3].x+20),y:Math.min(next.y,this._chartPoints[3].y-20)};
      else if(index===2)next={x:Math.max(next.x,this._chartPoints[0].x+20),y:Math.max(next.y,this._chartPoints[0].y+20)};
      else next={x:Math.min(next.x,this._chartPoints[1].x-20),y:Math.max(next.y,this._chartPoints[1].y+20)};
    }
    if(this.data.chartCornerMode==='free')this._chartPoints[index]=next;
    else if(index===0){this._chartPoints[0]=next;this._chartPoints[1].y=next.y;this._chartPoints[3].x=next.x;}
    else if(index===1){this._chartPoints[1]=next;this._chartPoints[0].y=next.y;this._chartPoints[2].x=next.x;}
    else if(index===2){this._chartPoints[2]=next;this._chartPoints[1].x=next.x;this._chartPoints[3].y=next.y;}
    else {this._chartPoints[3]=next;this._chartPoints[0].x=next.x;this._chartPoints[2].y=next.y;}
    this.drawChartCanvas();
  },
  chartTouchEnd(event){
    const gesture=this._chartGesture;
    if(event.touches&&event.touches.length===1){this._chartGesture=null;this.chartTouchStart(event);return;}
    this._chartGesture=null;
    if(gesture&&gesture.type==='handle'&&gesture.changed)this.refreshChartMatch();
  },
  selectChartCornerMode(event){
    const mode=event.currentTarget.dataset.mode;if(mode===this.data.chartCornerMode)return;
    if(mode==='rect'&&this._chartPoints){const xs=this._chartPoints.map(point=>point.x),ys=this._chartPoints.map(point=>point.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);this._chartPoints=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];this.drawChartCanvas();}
    this._chartGeometry=null;this._chartManualSize=false;
    this.setData({
      chartCornerMode:mode,chartAutoReady:false,chartMatchText:'正在重新匹配',
      chartHint:mode==='rect'?'截图模式：四格框保持长方形；空白处移动视图，双指缩放':'斜拍模式：四角可独立贴合；空白处移动视图，双指缩放'
    },()=>this.refreshChartMatch());
  },
  resetChartCorners(){this.initChartCanvas();},
  onChartSize(event){
    if(!this._chartGeometry)return;
    const key=event.currentTarget.dataset.key,raw=parseInt(event.detail.value,10)||2;
    const maximum=key==='chartColumns'
      ?this._chartGeometry.visibleEndColumn-this._chartGeometry.visibleStartColumn
      :this._chartGeometry.visibleEndRow-this._chartGeometry.visibleStartRow;
    const value=clamp(raw,2,maximum);
    if(value!==raw)wx.showToast({title:`完整图片最多容纳 ${maximum} 格`,icon:'none'});
    this._chartManualSize=true;
    this.setData({[key]:value,chartMatchText:`已手动修正为 ${key==='chartColumns'?value:this.data.chartColumns} × ${key==='chartRows'?value:this.data.chartRows} 格`,chartMatchDetail:'四格锚点保持不变，绿色范围不会超出图片'},()=>this.drawChartCanvas());
  },
  chooseChartPreset(event){
    if(!this._chartGeometry)return;
    const wanted=Number(event.currentTarget.dataset.value);
    const columns=clamp(wanted,2,this._chartGeometry.visibleEndColumn-this._chartGeometry.visibleStartColumn);
    const rows=clamp(wanted,2,this._chartGeometry.visibleEndRow-this._chartGeometry.visibleStartRow);
    this._chartManualSize=true;this.setData({chartColumns:columns,chartRows:rows},()=>this.drawChartCanvas());
  },
  onPixelBrand(event){const index=Number(event.detail.value),options=getPackageOptions(brands[index].value);this.setData({pixelBrandIndex:index,pixelPackageOptions:options,pixelPackageIndex:options.length-1});},
  onPixelPackage(event){this.setData({pixelPackageIndex:Number(event.detail.value)});},
  async generatePixelPattern(){
    try { await runLocalWithQuota({ quotaKey: 'bead_chart', label: '图纸识别', gate: this._localRewardedGate }, () => this.generatePixelPatternWithAccess()); }
    catch (error) { if (!isRewardCancellation(error)) this.setData({ pixelStatus: error.message || '图纸识别失败，请检查角点和格数。' }); }
  },
  async generatePixelPatternWithAccess(){
    this.setData({pixelBusy:true,pixelStatus:'正在校正网格、逐格取色并匹配品牌色号…'});
    try{
      if(!this._chartPoints||!this._chartImageBox)throw new Error('四格校准画布尚未准备好，请返回后重新选择图纸');
      const sample=await this.prepareChartSampleData(),reference=this.chartReferenceInSample(sample);
      if(!validateReferenceQuad(reference,sample.width,sample.height))throw new Error('四格参考框范围过小或角点交叉，请重新框选');
      if(!this._chartGeometry)await this.refreshChartMatch();
      const geometry=this.currentChartGeometry();
      if(!geometry)throw new Error('尚未匹配到完整网格，请重新框选中间边线清楚的 2×2 四格');
      const width=sample.width,height=sample.height,data=sample.data,points=geometry.fullPoints,columns=geometry.columns,rows=geometry.rows;
      const brand=brands[this.data.pixelBrandIndex],packageSize=this.data.pixelPackageOptions[this.data.pixelPackageIndex].value;this._palette=getPalette(brand.value,packageSize);
      const preparedPalette=preparePalette(this._palette);
      this._pattern=stabilizeNeutralCells(recognizeChart(data,width,height,points,columns,rows,rgb=>nearest(rgb,this._palette,preparedPalette)));
      this._chartSample=null;
      this._locked=Array.from({length:this._pattern.length},()=>Array(this._pattern[0].length).fill(false));this._undo=[];this._redo=[];
      this.setData({chartColumns:columns,chartRows:rows,resultWidth:columns,resultHeight:rows,pixelWidth:columns,pixelHeight:rows,brandIndex:this.data.pixelBrandIndex,packageOptions:this.data.pixelPackageOptions,packageIndex:this.data.pixelPackageIndex,paletteColors:this.paletteView(this._palette),selectedColorIndex:0,projectType:'chart',patternReady:true});
      await this.renderPattern();await this.saveCurrentProject('导入图纸识别结果','chart');this.setStage('editor');
    }catch(error){throw error;}finally{this.setData({pixelBusy:false});}
  },

  async startPhoto() {
    try {
      const result = await promisify(wx.chooseMedia, { count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] });
      const file = result.tempFiles[0];
      if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
      const path = await this.cacheSelectedImage(file.tempFilePath);
      this._originalSelectedPath = path;
      this.setData({ sourcePath: path, originalPath: path, generatedPath: '', cropRatio: 'original', styleIndex: 0, peopleCountMode: 'single', hairMode: 'strict', compositionMode: 'subject', removeBackground: false, cutoutConsent: false, uploadConsent: false, customRequest: '', aiGenerated: false, patternReady: false });
      this.setStage('crop');
      setTimeout(() => this.initCropper(true), 60);
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) wx.showToast({ title: error.message || '图片读取失败', icon: 'none' });
    }
  },
  cropRatioValue() {
    if (this.data.cropRatio === '1:1') return 1;
    if (this.data.cropRatio === '3:4') return .75;
    if (this.data.cropRatio === '4:3') return 4 / 3;
    if (this.data.cropRatio === 'free') return clamp(this.data.cropFreeRatio / 100, .35, 2.8);
    return this._cropImage ? this._cropImage.width / this._cropImage.height : 1;
  },
  cropRatioLabel() {
    const labels = { original: '原图比例', '1:1': '1 : 1', '3:4': '3 : 4', '4:3': '4 : 3' };
    return labels[this.data.cropRatio] || `${(this.data.cropFreeRatio / 100).toFixed(2)} : 1`;
  },
  cropFrame() {
    const width = this._cropViewport.width, height = this._cropViewport.height;
    const maximumWidth = width * this.data.cropFrameScale / 100, maximumHeight = height * this.data.cropFrameScale / 100;
    const ratio = this.cropRatioValue();
    let frameWidth = maximumWidth, frameHeight = frameWidth / ratio;
    if (frameHeight > maximumHeight) { frameHeight = maximumHeight; frameWidth = frameHeight * ratio; }
    return { left: (width - frameWidth) / 2, top: (height - frameHeight) / 2, width: frameWidth, height: frameHeight };
  },
  updateCropFrame(resetTransform) {
    if (!this._cropViewport || !this._cropImage) return;
    const frame = this.cropFrame(); this._cropFrame = frame;
    const minimum = Math.max(frame.width / this._cropImage.width, frame.height / this._cropImage.height);
    this._cropMinScale = minimum;
    if (resetTransform || !this._cropTransform) {
      this._cropTransform = { x: this._cropViewport.width / 2, y: this._cropViewport.height / 2, scale: minimum };
      this.setData({ cropZoom: 100 });
    } else this._cropTransform.scale = Math.max(minimum, this._cropTransform.scale);
    this.clampCropTransform();
    this.setData({
      cropFrameStyle: `width:${frame.width}px;height:${frame.height}px;left:${frame.left}px;top:${frame.top}px;`,
      cropFrameRatioText: this.cropRatioLabel(),
      cropZoom: Math.round(this._cropTransform.scale / minimum * 100)
    });
    this.drawCropCanvas();
  },
  async initCropper(resetTransform) {
    try {
      const query = await queryCanvas(this, '#cropCanvas'), canvas = query.node;
      const image = await loadCanvasImage(canvas, this.data.sourcePath), dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
      canvas.width = Math.round(query.width * dpr); canvas.height = Math.round(query.height * dpr);
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._cropCanvas = canvas; this._cropContext = ctx; this._cropImage = image; this._cropViewport = { width: query.width, height: query.height };
      this.updateCropFrame(resetTransform !== false);
    } catch (error) { wx.showToast({ title: error.message || '裁切预览初始化失败', icon: 'none', duration: 2600 }); }
  },
  drawCropCanvas() {
    if (!this._cropContext || !this._cropImage || !this._cropTransform) return;
    const ctx = this._cropContext, viewport = this._cropViewport, transform = this._cropTransform;
    ctx.clearRect(0, 0, viewport.width, viewport.height); ctx.fillStyle = '#eeeaf5'; ctx.fillRect(0, 0, viewport.width, viewport.height);
    const width = this._cropImage.width * transform.scale, height = this._cropImage.height * transform.scale;
    ctx.drawImage(this._cropImage, transform.x - width / 2, transform.y - height / 2, width, height);
  },
  clampCropTransform() {
    if (!this._cropTransform || !this._cropFrame) return;
    const transform = this._cropTransform, frame = this._cropFrame;
    transform.scale = clamp(transform.scale, this._cropMinScale, this._cropMinScale * 5);
    const imageWidth = this._cropImage.width * transform.scale, imageHeight = this._cropImage.height * transform.scale;
    transform.x = clamp(transform.x, frame.left + frame.width - imageWidth / 2, frame.left + imageWidth / 2);
    transform.y = clamp(transform.y, frame.top + frame.height - imageHeight / 2, frame.top + imageHeight / 2);
  },
  selectCropRatio(event) { this.setData({ cropRatio: event.currentTarget.dataset.value }, () => this.updateCropFrame(true)); },
  onCropFrameScale(event) { this.setData({ cropFrameScale: Number(event.detail.value) }, () => this.updateCropFrame(false)); },
  onCropFreeRatio(event) { this.setData({ cropFreeRatio: Number(event.detail.value) }, () => this.updateCropFrame(true)); },
  onCropZoom(event) {
    const value = Number(event.detail.value); this.setData({ cropZoom: value });
    if (this._cropTransform) { this._cropTransform.scale = this._cropMinScale * value / 100; this.clampCropTransform(); this.drawCropCanvas(); }
  },
  cropPoint(touch) { return { x: touch.x == null ? (touch.clientX == null ? touch.pageX : touch.clientX) : touch.x, y: touch.y == null ? (touch.clientY == null ? touch.pageY : touch.clientY) : touch.y }; },
  cropTouchStart(event) {
    const touches = event.touches || [];
    if (touches.length >= 2) {
      const first = this.cropPoint(touches[0]), second = this.cropPoint(touches[1]);
      const dx = first.x - second.x, dy = first.y - second.y;
      this._cropGesture = { type: 'pinch', distance: Math.hypot(dx, dy), scale: this._cropTransform.scale };
    } else if (touches.length === 1) { const point = this.cropPoint(touches[0]); this._cropGesture = { type: 'move', x: point.x, y: point.y, centerX: this._cropTransform.x, centerY: this._cropTransform.y }; }
  },
  cropTouchMove(event) {
    const touches = event.touches || [], gesture = this._cropGesture; if (!gesture) return;
    if (gesture.type === 'pinch' && touches.length >= 2) {
      const first = this.cropPoint(touches[0]), second = this.cropPoint(touches[1]);
      const dx = first.x - second.x, dy = first.y - second.y;
      this._cropTransform.scale = gesture.scale * Math.hypot(dx, dy) / Math.max(1, gesture.distance);
      this.setData({ cropZoom: Math.round(this._cropTransform.scale / this._cropMinScale * 100) });
    } else if (gesture.type === 'move' && touches.length === 1) {
      const point = this.cropPoint(touches[0]); this._cropTransform.x = gesture.centerX + point.x - gesture.x; this._cropTransform.y = gesture.centerY + point.y - gesture.y;
    }
    this.clampCropTransform(); this.drawCropCanvas();
  },
  cropTouchEnd() { this._cropGesture = null; },
  cropHandlePoint(touch) { return { x: touch.clientX == null ? (touch.pageX == null ? touch.x : touch.pageX) : touch.clientX, y: touch.clientY == null ? (touch.pageY == null ? touch.y : touch.pageY) : touch.clientY }; },
  cropHandleStart(event) {
    const touch = event.touches && event.touches[0]; if (!touch || !this._cropFrame) return;
    const point = this.cropHandlePoint(touch), frame = { ...this._cropFrame };
    this._cropHandleGesture = { corner: event.currentTarget.dataset.corner, point, frame };
  },
  cropHandleMove(event) {
    const gesture = this._cropHandleGesture, touch = event.touches && event.touches[0];
    if (!gesture || !touch || !this._cropViewport) return;
    const point = this.cropHandlePoint(touch), dx = point.x - gesture.point.x, dy = point.y - gesture.point.y;
    const corner = gesture.corner, original = gesture.frame, isLeft = corner.indexOf('l') >= 0, isTop = corner.indexOf('t') >= 0;
    const anchorX = isLeft ? original.left + original.width : original.left;
    const anchorY = isTop ? original.top + original.height : original.top;
    const originalCornerX = isLeft ? original.left : original.left + original.width;
    const originalCornerY = isTop ? original.top : original.top + original.height;
    const maximumWidth = isLeft ? anchorX : this._cropViewport.width - anchorX;
    const maximumHeight = isTop ? anchorY : this._cropViewport.height - anchorY;
    let width = clamp(Math.abs(originalCornerX + dx - anchorX), 54, maximumWidth);
    let height = clamp(Math.abs(originalCornerY + dy - anchorY), 54, maximumHeight);
    if (this.data.cropRatio !== 'free') {
      const ratio = this.cropRatioValue();
      if (width / ratio >= height) height = width / ratio; else width = height * ratio;
      const fit = Math.min(1, maximumWidth / width, maximumHeight / height);
      width *= fit; height *= fit;
      const minimumScale = Math.max(54 / width, 54 / height, 1);
      width = Math.min(maximumWidth, width * minimumScale); height = Math.min(maximumHeight, height * minimumScale);
    } else {
      this.data.cropFreeRatio = Math.round(clamp(width / height, .35, 2.8) * 100);
    }
    const frame = { left: isLeft ? anchorX - width : anchorX, top: isTop ? anchorY - height : anchorY, width, height };
    this._cropFrame = frame;
    this._cropMinScale = Math.max(frame.width / this._cropImage.width, frame.height / this._cropImage.height);
    this._cropTransform.scale = Math.max(this._cropTransform.scale, this._cropMinScale);
    this.clampCropTransform();
    const ratioText = this.data.cropRatio === 'free' ? `${(width / height).toFixed(2)} : 1` : this.cropRatioLabel();
    this.setData({
      cropFreeRatio: this.data.cropFreeRatio,
      cropFrameStyle: `width:${frame.width}px;height:${frame.height}px;left:${frame.left}px;top:${frame.top}px;`,
      cropFrameRatioText: ratioText,
      cropZoom: Math.round(this._cropTransform.scale / this._cropMinScale * 100)
    });
    this.drawCropCanvas();
  },
  cropHandleEnd() { this._cropHandleGesture = null; },
  async rotatePhoto() {
    try {
      this.setData({ cropBusy: true });
      const source = this.data.sourcePath;
      const query = await queryCanvas(this, '#sampleCanvas');
      const canvas = query.node, image = await loadCanvasImage(canvas, source);
      canvas.width = image.height; canvas.height = image.width;
      const ctx = canvas.getContext('2d'); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(Math.PI / 2);
      ctx.drawImage(image, -image.width / 2, -image.height / 2);
      const file = await canvasToFile(this, canvas, { fileType: 'png', destWidth: canvas.width, destHeight: canvas.height });
      this.setData({ sourcePath: file.tempFilePath }, () => setTimeout(() => this.initCropper(true), 40));
    } catch (_) { wx.showToast({ title: '旋转失败，请重新选择图片', icon: 'none' }); }
    finally { this.setData({ cropBusy: false }); }
  },
  async confirmCrop() {
    try {
      this.setData({ cropBusy: true });
      if (!this._cropFrame || !this._cropTransform) await this.initCropper(true);
      const frame = this._cropFrame, transform = this._cropTransform, image = this._cropImage;
      const displayedWidth = image.width * transform.scale, displayedHeight = image.height * transform.scale;
      const imageLeft = transform.x - displayedWidth / 2, imageTop = transform.y - displayedHeight / 2;
      const sourceX = clamp((frame.left - imageLeft) / transform.scale, 0, image.width);
      const sourceY = clamp((frame.top - imageTop) / transform.scale, 0, image.height);
      const sourceWidth = clamp(frame.width / transform.scale, 1, image.width - sourceX);
      const sourceHeight = clamp(frame.height / transform.scale, 1, image.height - sourceY);
      const query = await queryCanvas(this, '#sampleCanvas'), canvas = query.node, outputImage = await loadCanvasImage(canvas, this.data.sourcePath);
      const outputScale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.max(1, Math.round(sourceWidth * outputScale)); canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(outputImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const cropped = await canvasToFile(this, canvas, { fileType: 'jpg', quality: .94, destWidth: canvas.width, destHeight: canvas.height });
      const path = cropped.tempFilePath;
      const info = await promisify(wx.getImageInfo, { src: path });
      const aspect = info.width / info.height;
      this.setData({ sourcePath: path, originalPath: path, sourceAspect: aspect });
      this.updateDimensions(this.data.longSide, aspect);
      this.setStage('style');
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) wx.showToast({ title: '裁切失败，请重试', icon: 'none' });
    } finally { this.setData({ cropBusy: false }); }
  },

  selectStyle(event) {
    if (this.data.aiBusy) return;
    const styleIndex = Number(event.currentTarget.dataset.index);
    const previous = AI_STYLES[this.data.styleIndex];
    const next = AI_STYLES[styleIndex];
    const updates = { styleIndex, aiStatus: '' };
    // “使用原图”必须默认保留用户看到的完整画面。只有用户随后明确选择
    // “抠出主体”，拼豆引擎才允许删除边缘背景。
    if (next && next.value === 'original') {
      updates.compositionMode = 'scene';
      updates.removeBackground = false;
      updates.cutoutConsent = false;
    } else if (previous && previous.value === 'original') {
      updates.compositionMode = 'subject';
    }
    this.setData(updates);
  },
  selectPeopleCount(event) { if (!this.data.aiBusy) this.setData({ peopleCountMode: event.currentTarget.dataset.value, aiStatus: '' }); },
  selectHairMode(event) { if (!this.data.aiBusy) this.setData({ hairMode: event.currentTarget.dataset.value, aiStatus: '' }); },
  selectComposition(event) {
    if (this.data.aiBusy) return;
    const compositionMode = event.currentTarget.dataset.value;
    this.setData({
      compositionMode,
      aiStatus: '',
      ...(compositionMode === 'scene' ? { removeBackground: false, cutoutConsent: false } : {})
    });
  },
  onCustomRequest(event) { if (!this.data.aiBusy) this.setData({ customRequest: String(event.detail.value || '').slice(0, 100) }); },
  toggleUploadConsent() { if (!this.data.aiBusy) this.setData({ uploadConsent: !this.data.uploadConsent }); },
  async createAIUploadImage() {
    const query = await queryCanvas(this, '#sampleCanvas'), canvas = query.node;
    const image = await loadCanvasImage(canvas, this.data.originalPath);
    // 在送入模型前真实扩展 16% 的白色底边，让生成构图为平台角标预留空间。
    const paddedHeight = image.height / .84;
    const scale = Math.min(1, 2048 / Math.max(image.width, paddedHeight));
    const imageWidth = Math.max(1, Math.round(image.width * scale)), imageHeight = Math.max(1, Math.round(image.height * scale));
    canvas.width = imageWidth; canvas.height = Math.max(1, Math.round(paddedHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, imageWidth, imageHeight);
    const colorAnchors = extractColorAnchors(ctx, imageWidth, imageHeight, this.data.compositionMode === 'subject');
    const file = await canvasToFile(this, canvas, { fileType: 'jpg', quality: .86, destWidth: canvas.width, destHeight: canvas.height });
    return { filePath: file.tempFilePath, colorAnchors };
  },
  async continueStyle() {
    if (this.data.aiBusy) return;
    if (AI_STYLES[this.data.styleIndex].value === 'original') {
      await this.enterSettings(this.data.originalPath, false); return;
    }
    if (!this.data.uploadConsent) { this.setData({ aiStatus: '请先同意照片临时上传及风格转换说明。', aiStatusType: 'error' }); return; }
    await this.generateAI();
  },
  async generateAI() {
    try { await runServerWithQuota({ quotaKey: 'bead_ai', label: 'AI生图', gate: this._aiRewardedGate }, () => this.generateAIWithAccess()); }
    catch (error) { if (!isRewardCancellation(error)) this.setData({ aiStatus: error.message || '风格转换失败，请稍后重试或使用原图。', aiStatusType: 'error' }); }
  },
  async generateAIWithAccess() {
    let sourceID = '', resultID = '';
    const startedAt = Date.now();
    this.setData({ aiBusy: true, aiProgress: 6, aiElapsedText: '正在准备照片', aiStatus: '', aiStatusType: '' });
    clearInterval(this._aiProgressTimer);
    this._aiProgressTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const progress = Math.min(92, 8 + Math.floor(seconds * 1.35));
      this.setData({ aiProgress: progress, aiElapsedText: `正在转换 · 已等待 ${seconds} 秒` });
    }, 1000);
    try {
      const uploadImage = await this.createAIUploadImage();
      sourceID = await uploadTemporary(uploadImage.filePath, 'jpg');
      const style = AI_STYLES[this.data.styleIndex];
      const result = await callTool('generateBeadStyle', { sourceFileID: sourceID, style: style.value, prompt: style.prompt, peopleCount: style.people ? this.data.peopleCountMode : '', hairMode: style.people ? this.data.hairMode : '', compositionMode: this.data.compositionMode, customRequest: this.data.customRequest, colorAnchors: uploadImage.colorAnchors });
      resultID = result.fileID;
      const downloaded = await downloadTemporary(resultID);
      const path = await this.cropGeneratedSafeBand(downloaded);
      this.setData({ generatedPath: path, aiGenerated: true, aiProgress: 100, aiElapsedText: '生成完成', aiStatus: '', aiStatusType: '' });
      this.setStage('aiResult');
    } catch (error) {
      this.setData({ aiStatus: error.message || '风格转换失败，请稍后重试或使用原图。', aiStatusType: 'error' });
    } finally {
      clearInterval(this._aiProgressTimer); this._aiProgressTimer = null;
      await cleanup([sourceID, resultID].filter(Boolean));
      this.setData({ aiBusy: false });
    }
  },
  async cropGeneratedSafeBand(path) {
    const query = await queryCanvas(this, '#sampleCanvas'), canvas = query.node;
    const image = await loadCanvasImage(canvas, path);
    // 只裁最底部 8% 的角标区域；生成时预留了 16% 白边，因此裁后仍保留
    // 约 8% 的安全留白，不会贴着脚部、尾巴或底部轮廓切割。
    const sourceHeight = Math.max(1, Math.floor(image.height * .92));
    const scale = Math.min(1, 2048 / Math.max(image.width, sourceHeight));
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, image.width, sourceHeight, 0, 0, canvas.width, canvas.height);
    const file = await canvasToFile(this, canvas, { fileType: 'jpg', quality: .94, destWidth: canvas.width, destHeight: canvas.height });
    return file.tempFilePath;
  },
  regenerateAI() { if (!this.data.aiBusy) { this.setData({ aiProgress: 0, aiElapsedText: '', aiStatus: '' }); this.setStage('style'); } },
  async enterSettings(path, aiGenerated) {
    try {
      const info = await promisify(wx.getImageInfo, { src: path });
      const aspect = info.width / info.height;
      this.setData({ sourcePath: path, sourceAspect: aspect, aiGenerated, longSide: 52, colorPresetIndex: 0, colorUsageMode: 'compact', brightness: 100, contrast: 100, saturation: 100, settingsPreviewPath: '' });
      this.updateDimensions(52, aspect);
      this.setStage('settings');
      this.scheduleSettingsPreview(50);
    } catch (_) { wx.showToast({ title: '图片尺寸读取失败，请重试', icon: 'none' }); }
  },
  async acceptAI() { await this.enterSettings(this.data.generatedPath, true); },
  async useOriginal() {
    // 结果页的“直接使用原图”同样属于原图模式，不能继承刚才 AI 生成时
    // 选择的“抠出主体”，否则用户会在设置页看到被挖空的原始场景。
    this.setData({ compositionMode: 'scene', removeBackground: false, cutoutConsent: false });
    await this.enterSettings(this.data.originalPath, false);
  },

  updateDimensions(longSide, aspect) {
    const size = clamp(Number(longSide) || 52, 16, GENERATED_PATTERN_MAX_SIDE), ratio = aspect || this.data.sourceAspect || 1;
    const width = ratio >= 1 ? size : Math.max(8, Math.round(size * ratio));
    const height = ratio >= 1 ? Math.max(8, Math.round(size / ratio)) : size;
    this.setData({ longSide: size, resultWidth: width, resultHeight: height, physicalSizeText: `约 ${(width * .5).toFixed(1)} × ${(height * .5).toFixed(1)} 厘米` });
  },
  selectSize(event) { this.updateDimensions(Number(event.currentTarget.dataset.value)); this.scheduleSettingsPreview(); },
  onSizeChange(event) { this.updateDimensions(Number(event.detail.value)); this.scheduleSettingsPreview(); },
  onSizeInput(event) {
    const raw = Number(event.detail.value), value = clamp(Number.isFinite(raw) && raw ? Math.round(raw) : this.data.longSide, 16, GENERATED_PATTERN_MAX_SIDE);
    if (raw && raw !== value) wx.showToast({ title: `请输入 16–${GENERATED_PATTERN_MAX_SIDE}`, icon: 'none' });
    this.updateDimensions(value); this.scheduleSettingsPreview();
  },
  onBrandChange(event) {
    const brandIndex = Number(event.detail.value), brand = brands[brandIndex], options = getPackageOptions(brand.value);
    this.setData({ brandIndex, packageOptions: options, packageIndex: options.length - 1 }); this.scheduleSettingsPreview();
  },
  onPackageChange(event) { this.setData({ packageIndex: Number(event.detail.value) }); this.scheduleSettingsPreview(); },
  selectColorUsage(event) {
    const colorUsageMode = event.currentTarget.dataset.value;
    this.setData({ colorUsageMode, settingsPreviewPath: '', settingsPreviewBusy: true }, () => this.scheduleSettingsPreview(0));
  },
  selectColorPreset(event) {
    const index = Number(event.currentTarget.dataset.index), preset = COLOR_PRESETS[index];
    if (!preset) return;
    this.setData({ colorPresetIndex: index, brightness: preset.brightness, contrast: preset.contrast, saturation: preset.saturation }); this.scheduleSettingsPreview();
  },
  onSlider(event) {
    const key = event.currentTarget.dataset.key, value = Number(event.detail.value);
    this.setData({ [key]: value, colorPresetIndex: -1 }); this.scheduleSettingsPreview();
  },
  onDenoise(event) { this.setData({ denoiseIndex: Number(event.detail.value) }); this.scheduleSettingsPreview(); },
  onFit(event) { this.setData({ fitIndex: Number(event.detail.value) }); this.scheduleSettingsPreview(); },
  toggleSetting(event) { const key = event.currentTarget.dataset.key; this.setData({ [key]: !this.data[key] }); if (key !== 'cutoutConsent' && key !== 'removeBackground') this.scheduleSettingsPreview(); },

  mapOptions(detectedSourceKind) {
    const fit = FIT_OPTIONS[this.data.fitIndex].value;
    const longSide = this.data.longSide;
    const presetSize = SIZE_PRESETS.some(item => item.value === longSide);
    // AI 前稿默认做轻量的明度和彩度恢复。模型输出的 JPG、缩放和区域平均会
    // 连续损失少量饱和度；不补偿时，粉、青、棕等大色块进入色卡后普遍发灰。
    // 只在“就按原图”默认预设生效，用户主动选择柔和/清淡等风格时不干预。
    const aiDefaultColorAssist = this.data.aiGenerated && this.data.colorPresetIndex === 0;
    // 两种模式共用完整 221 色基础图。丰富模式会先稳定连续色块、清理缩放和
    // 渐变产生的近色碎点；减少颜色再跨区域复用主色。
    const compactMinimumArea = longSide <= 36 ? 2 : (longSide <= 60 ? 3 : (longSide <= 84 ? 4 : 5));
    return {
      brightness: aiDefaultColorAssist ? Math.min(150, this.data.brightness + 3) : this.data.brightness,
      contrast: fit === 'clear' ? Math.min(150, this.data.contrast + 12) : this.data.contrast,
      saturation: this.data.saturation,
      accentBoost: aiDefaultColorAssist ? 1.12 : 1,
      regionMode: this.data.colorUsageMode,
      minimumRegionArea: compactMinimumArea,
      denoise: DENOISE_OPTIONS[this.data.denoiseIndex].value,
      removeNoise: this.data.removeNoise || fit === 'clear',
      smoothEdges: this.data.smoothEdges,
      // “保留场景”不能在拼豆阶段又把边缘背景自动删除；只有选择仅保留主体
      // 时才执行边缘连通背景清理。
      localBackground: this.data.compositionMode === 'subject' && this.data.localBackground,
      backgroundMode: this.data.compositionMode === 'subject' ? 'subject' : 'auto',
      preserveOutline: true,
      // 自动描边只用于“抠出主体”的独立挂件。完整画面中白底、天空或墙面
      // 也是画面内容；若仍按主体逻辑描边，会给整张画布套黑框，并把深蓝、
      // 深棕等大色面误压成黑色。
      outlineMode: this.data.compositionMode === 'subject' && longSide <= 52 ? 'auto' : 'off',
      preserveEyeHighlights: true,
      preserveKeyFeatures: true,
      restoreInterior: true,
      // “仅保留主体”最终需要能作为一整件平面拼豆拿起：照片、普通插画和
      // AI 前稿都只保留主实体。文字/Logo 会由引擎识别为 graphic 并自动
      // 豁免，避免删除彼此分开的字与标志笔画。
      physicalIntegrity: this.data.compositionMode === 'subject',
      outlineStrength: longSide <= 36 ? 2 : (presetSize ? 1 : (longSide <= 60 ? 1 : 0)),
      // 黑色强包边同样只服务于 32/52 的独立主体挂件。完整画面必须忠于
      // 原图边缘，不能把白色画布外沿包成一个黑色矩形。
      blackBoundary: this.data.compositionMode === 'subject' && longSide <= 52,
      boundaryRounding: longSide <= 36 ? 2 : 1,
      boundaryBumpPasses: longSide <= 52 ? 2 : 1,
      ensureClosedBoundary: this.data.compositionMode === 'subject' && presetSize && longSide <= 52,
      // AI 输出是平滑插画；用户直接导入的图片交给引擎保守判断是否属于
      // 文字/Logo 等硬边图形，避免把字腔填实或强制套照片式黑包边。
      sourceKind: detectedSourceKind || (this.data.aiGenerated ? 'illustration' : 'auto')
    };
  },
  scheduleSettingsPreview(delay = 240) {
    clearTimeout(this._settingsPreviewTimer);
    this._settingsPreviewTimer = setTimeout(() => this.refreshSettingsPreview(), delay);
  },
  async refreshSettingsPreview() {
    if (this.data.stage !== 'settings' || !this.data.sourcePath) return;
    const token = Date.now(); this._settingsPreviewToken = token;
    this.setData({ settingsPreviewBusy: true });
    try {
      const sample = await this.sampleImage(this.data.sourcePath);
      const brand = brands[this.data.brandIndex], packageSize = this.data.packageOptions[this.data.packageIndex].value;
      const palette = getPalette(brand.value, packageSize);
      const pattern = mapPixels(sample.data, sample.width, sample.height, palette, this.mapOptions(sample.sourceKind));
      const summary = recount(pattern, palette);
      const query = await queryCanvas(this, '#settingsPreviewCanvas'), canvas = query.node;
      const scale = Math.max(2, Math.floor(760 / Math.max(sample.width, sample.height)));
      canvas.width = sample.width * scale; canvas.height = sample.height * scale;
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fffafd'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      pattern.forEach((row, y) => row.forEach((color, x) => {
        if (!color) return;
        ctx.fillStyle = `rgb(${color[2]},${color[3]},${color[4]})`; ctx.fillRect(x * scale, y * scale, scale, scale);
        ctx.strokeStyle = 'rgba(92,91,106,.16)'; ctx.lineWidth = Math.max(.6, scale * .035); ctx.strokeRect(x * scale + .5, y * scale + .5, scale - 1, scale - 1);
      }));
      const file = await canvasToFile(this, canvas, { fileType: 'png', destWidth: canvas.width, destHeight: canvas.height });
      if (this._settingsPreviewToken === token) this.setData({
        settingsPreviewPath: file.tempFilePath,
        settingsPreviewTotal: summary.total,
        settingsPreviewColors: summary.materials.length,
        settingsPreviewQrInfo: sample.qrStructure
          ? `已识别标准二维码 · ${sample.qrModuleCount} × ${sample.qrModuleCount} 模块 · 每模块 ${sample.qrScale} 格`
          : ''
      });
    } catch (_) {
      if (this._settingsPreviewToken === token) this.setData({ settingsPreviewPath: '', settingsPreviewQrInfo: '' });
    } finally { if (this._settingsPreviewToken === token) this.setData({ settingsPreviewBusy: false }); }
  },
  async prepareCutout(path) {
    if (!this.data.removeBackground) return path;
    if (!this.data.cutoutConsent) throw new Error('请先同意智能去背景的临时上传说明。');
    return runServerWithQuota({ quotaKey: 'remove_background', label: '智能去背景', gate: this._removeBackgroundGate }, () => this.prepareCutoutWithAccess(path));
  },
  async prepareCutoutWithAccess(path) {
    let sourceID = '', resultID = '';
    try {
      sourceID = await uploadTemporary(path, 'png');
      const result = await callTool('removeBackground', { sourceFileID: sourceID, kind: 'beads' });
      resultID = result.fileID;
      return await downloadTemporary(resultID);
    } finally { await cleanup([sourceID, resultID].filter(Boolean)); }
  },
  async sampleImage(path, targetWidth, targetHeight, pixelated) {
    const query = await queryCanvas(this, '#sampleCanvas'), canvas = query.node, image = await loadCanvasImage(canvas, path);
    const width = targetWidth || this.data.resultWidth, height = targetHeight || this.data.resultHeight;
    if (pixelated) {
      canvas.width = width; canvas.height = height;
      const pixelContext = canvas.getContext('2d'); pixelContext.clearRect(0, 0, width, height); pixelContext.imageSmoothingEnabled = false;
      pixelContext.drawImage(image, 0, 0, width, height);
      return pixelContext.getImageData(0, 0, width, height);
    }

    // 在缩成豆格前先用 4× 分辨率建立主体遮罩。52 格下的一格描边对应这里
    // 的四个像素，白衣、白毛和白色卡通身体便不会在识别背景之前就被平均掉。
    const sampleScale = Math.max(width, height) <= 60 ? 4 : 2;
    canvas.width = width * sampleScale; canvas.height = height * sampleScale;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const sampled = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return prepareSubjectSample(sampled.data, canvas.width, canvas.height, width, height, {
      localBackground: this.data.compositionMode === 'subject' && this.data.localBackground,
      backgroundMode: this.data.compositionMode === 'subject' ? 'subject' : 'auto',
      sourceKind: this.data.aiGenerated ? 'illustration' : 'auto'
    });
  },
  async generatePattern() {
    if (this.data.aiGenerated) {
      try { return await this.generatePatternWithAccess(); }
      catch (error) { this.setData({ status: error.message || '图纸生成失败，请调整参数后重试。', statusType: 'error' }); return; }
    }
    try { await runLocalWithQuota({ quotaKey: 'bead_original', label: '原图生成', gate: this._localRewardedGate }, () => this.generatePatternWithAccess()); }
    catch (error) { if (!isRewardCancellation(error)) this.setData({ status: error.message || '图纸生成失败，请调整参数后重试。', statusType: 'error' }); }
  },
  async generatePatternWithAccess() {
    this.setData({ busy: true, progress: 8, status: '正在准备图片…', statusType: '' });
    try {
      const source = await this.prepareCutout(this.data.sourcePath);
      this.setData({ progress: 30, status: '正在读取像素并匹配品牌色号…' });
      const sample = await this.sampleImage(source), brand = brands[this.data.brandIndex];
      const packageSize = this.data.packageOptions[this.data.packageIndex].value;
      this._palette = getPalette(brand.value, packageSize);
      this._pattern = mapPixels(sample.data, sample.width, sample.height, this._palette, this.mapOptions(sample.sourceKind));
      this._undo = []; this._redo = [];
      const projectType = sample.qrStructure ? 'qr' : (this.data.aiGenerated ? 'ai' : 'photo');
      this.setData({ progress: 76, status: '正在绘制图纸和统计材料…', paletteColors: this.paletteView(this._palette), selectedColorIndex: 0, projectType });
      await this.renderPattern();
      await this.saveCurrentProject(sample.qrStructure ? '二维码图纸' : (this.data.aiGenerated ? '风格照片图纸' : '照片图纸'), projectType);
      this.setData({
        progress: 100,
        patternReady: true,
        status: sample.qrStructure
          ? `已按 ${sample.qrModuleCount} × ${sample.qrModuleCount} 标准模块重建，严格使用两种材料色并保留扫码静区。`
          : '图纸已生成，可点击颜色快速定位或继续修图。',
        statusType: 'success'
      });
      this.setStage('editor');
    } catch (error) { throw error; }
    finally { this.setData({ busy: false }); }
  },

  startQR() {
    const palette = getPalette('mard', 221), sorted = palette.slice().sort((a, b) => luminance(a) - luminance(b));
    this._palette = palette;
    const dark = palette.findIndex(item => item[0] === sorted[0][0]), light = palette.findIndex(item => item[0] === sorted[sorted.length - 1][0]);
    this.setData({ paletteColors: this.paletteView(palette), qrForegroundIndex: dark, qrBackgroundIndex: light, qrContent: '', patternName: '', qrStatus: '' });
    this.setStage('qr');
  },
  onQRContent(event) { this.setData({ qrContent: String(event.detail.value || '').slice(0, 500) }); },
  onPatternName(event) { this.setData({ patternName: String(event.detail.value || '').slice(0, 60) }); },
  onQRColor(event) { this.setData({ [event.currentTarget.dataset.key]: Number(event.detail.value) }); },
  onQRSize(event) { this.setData({ qrSizeIndex: Number(event.detail.value) }); },
  async generateQR() {
    try { await runLocalWithQuota({ quotaKey: 'bead_qr', label: '二维码拼豆生成', gate: this._localRewardedGate }, () => this.generateQRWithAccess()); }
    catch (error) { if (!isRewardCancellation(error)) this.setData({ qrStatus: error.message || '二维码生成失败，请缩短内容。' }); }
  },
  async generateQRWithAccess() {
    const content = this.data.qrContent.trim();
    if (!content) { this.setData({ qrStatus: '请输入二维码内容。' }); return; }
    const patternName = normalizePatternName(this.data.patternName);
    const foreground = this._palette[this.data.qrForegroundIndex], background = this._palette[this.data.qrBackgroundIndex];
    if (Math.abs(luminance(foreground) - luminance(background)) < 110) { this.setData({ qrStatus: '前景色和背景色对比不足，请选择更深与更浅的组合。' }); return; }
    try {
      const qr = createQr(content, 'H');
      const count = qr.getModuleCount(), quiet = 4, scale = [1, 2, 3, 4][this.data.qrSizeIndex];
      const width = (count + quiet * 2) * scale, pattern = [];
      for (let y = -quiet; y < count + quiet; y += 1) for (let sy = 0; sy < scale; sy += 1) {
        const row = [];
        for (let x = -quiet; x < count + quiet; x += 1) for (let sx = 0; sx < scale; sx += 1) row.push(x >= 0 && y >= 0 && x < count && y < count && qr.isDark(y, x) ? foreground : background);
        pattern.push(row);
      }
      if (width > GENERATED_PATTERN_MAX_SIDE) throw new Error('二维码内容较长，请减少文字或选择更小的图纸倍率。');
      this._pattern = pattern; this._undo = []; this._redo = [];
      this.setData({ resultWidth: width, resultHeight: width, brandIndex: 0, packageOptions: getPackageOptions('mard'), packageIndex: getPackageOptions('mard').length - 1, paletteColors: this.paletteView(this._palette), patternName, qrStatus: '', projectType: 'qr' });
      await this.renderPattern();
      await this.saveCurrentProject('二维码图纸', 'qr');
      this.setData({ patternReady: true, status: '二维码结构检查通过。制作时请完整保留四周浅色区域。', statusType: 'success' });
      this.setStage('editor');
    } catch (error) { throw error; }
  },

  paletteView(palette) { return palette.map(item => ({ code: item[0], name: item[1], r: item[2], g: item[3], b: item[4] })); },
  recount() { return recount(this._pattern, this._palette); },
  async drawPattern(options = {}) {
    const query = await queryCanvas(this, '#exportCanvas'), canvas = query.node;
    const height = this._pattern.length, width = this._pattern[0].length;
    const summary = this.recount(), includeLegend = !!options.includeLegend, qrSafe = this.data.projectType === 'qr';
    const columns = Math.min(4, Math.max(1, summary.materials.length)), legendRows = Math.ceil(summary.materials.length / columns);
    const cell = clamp(Math.floor((includeLegend ? 3600 : 1600) / Math.max(width, height)), 10, includeLegend ? 30 : 24);
    const header = Math.max(30, cell * 2), legendWidth = includeLegend ? Math.max(900, columns * 390) : 0;
    const gridWidth = width * cell + header * 2, canvasWidth = Math.max(gridWidth, legendWidth);
    const patternName = includeLegend && this.data.projectType === 'qr' ? normalizePatternName(this.data.patternName) : '';
    const nameBandHeight = patternName ? 76 : 0;
    // 小程序码和材料清单共用一段高度，但占用清单右侧的独立空白带；
    // 材料的列数、行距和起始位置保持不变，不会被小程序码挤压或覆盖。
    const miniProgramCodeSize = includeLegend ? clamp(Math.round(canvasWidth * .085), 112, 136) : 0;
    const legendContentHeight = includeLegend ? Math.max(legendRows * 38, miniProgramCodeSize) : 0;
    const legendHeight = includeLegend ? 98 + legendContentHeight + 22 : 0;
    canvas.width = canvasWidth; canvas.height = height * cell + header * 2 + nameBandHeight + legendHeight;
    let miniProgramCode = null;
    if (includeLegend) {
      try { miniProgramCode = await loadCanvasImage(canvas, MINI_PROGRAM_CODE_PATH); }
      catch (_) { throw new Error('brand_code_not_loaded'); }
    }
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const originX = Math.floor((canvas.width - gridWidth) / 2) + header, originY = header + nameBandHeight;
    const qrGeometry = qrSafe ? inferQrGridGeometry(this._pattern) : null;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(7, Math.floor(cell * .38))}px sans-serif`;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const color = this._pattern[y][x], px = originX + x * cell, py = originY + y * cell;
      if (color) {
        ctx.fillStyle = `rgb(${color[2]},${color[3]},${color[4]})`;
      } else ctx.fillStyle = '#fff';
      ctx.fillRect(px, py, cell, cell);
      // QR 的一个豆格可能正好就是一个逻辑模块。二维码色号不能使用普通图纸
      // 的居中纯黑/纯白文字，否则会覆盖扫码器采样的模块中心。改为左上角低
      // 对比度色号：保留制作所需的逐格编号，同时让模块中心保持完整。
      ctx.strokeStyle = qrSafe ? 'rgba(22,45,42,.08)' : (this.data.gridBold ? 'rgba(22,45,42,.58)' : 'rgba(22,45,42,.24)');
      ctx.strokeRect(px, py, cell, cell);
      if (color) {
        const darkCell = luminance(color) < 142;
        const protectedQrCell = qrSafe && darkCell && isQrFunctionCell(x, y, qrGeometry);
        ctx.fillStyle = qrSafe
          ? (darkCell
            ? (protectedQrCell ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.28)')
            : 'rgba(16,43,41,.28)')
          : (darkCell ? '#fff' : '#111');
        if (qrSafe) {
          const inset = Math.max(2, Math.floor(cell * .08));
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(color[0], px + inset, py + inset);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        } else ctx.fillText(color[0], px + cell / 2, py + cell / 2);
      }
    }
    ctx.fillStyle = '#dbe5e1'; ctx.font = '600 12px sans-serif';
    for (let x = 0; x < width; x += 1) ctx.fillText(String(x + 1), originX + x * cell + cell / 2, originY - header / 2);
    for (let y = 0; y < height; y += 1) ctx.fillText(String(y + 1), originX - header / 2, originY + y * cell + cell / 2);
    if (includeLegend) {
      const topSignatureY = Math.max(10, Math.round(header * .2));
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(16,43,43,.5)'; ctx.font = '600 10px sans-serif';
      ctx.fillText(`${APP_NAME} · SamVibe`, 24, topSignatureY);
      ctx.textAlign = 'right'; ctx.fillText(OFFICIAL_URL.replace(/^https?:\/\//, ''), canvas.width - 24, topSignatureY);
      ctx.textAlign = 'center';
      if (patternName) {
        const bandTop = Math.max(22, Math.round(header * .34));
        ctx.fillStyle = '#f7fbfa'; ctx.fillRect(24, bandTop, canvas.width - 48, nameBandHeight - 10);
        ctx.strokeStyle = '#dcebe7'; ctx.lineWidth = 1; ctx.strokeRect(24, bandTop, canvas.width - 48, nameBandHeight - 10);
        ctx.fillStyle = '#173d39'; ctx.font = '700 22px sans-serif';
        const lines = fitCanvasLines(ctx, patternName, canvas.width - 96, 2);
        const lineHeight = 27, firstY = bandTop + (nameBandHeight - 10 - (lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, index) => ctx.fillText(line, canvas.width / 2, firstY + index * lineHeight));
      }
    }
    if (!qrSafe) {
      ctx.strokeStyle = 'rgba(10,50,46,.72)'; ctx.setLineDash([6, 5]);
      for (let x = 29; x < width; x += 29) { ctx.beginPath(); ctx.moveTo(originX + x * cell, originY); ctx.lineTo(originX + x * cell, originY + height * cell); ctx.stroke(); }
      for (let y = 29; y < height; y += 29) { ctx.beginPath(); ctx.moveTo(originX, originY + y * cell); ctx.lineTo(originX + width * cell, originY + y * cell); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (includeLegend) {
      const top = originY + height * cell + header;
      ctx.textAlign = 'left'; ctx.fillStyle = '#102b2b'; ctx.font = '700 24px sans-serif'; ctx.fillText(`${APP_NAME} · 材料清单`, 24, top + 24);
      ctx.textAlign = 'right'; ctx.fillStyle = '#c75f8d'; ctx.font = '700 15px sans-serif'; ctx.fillText(`微信搜索「${SEARCH_KEYWORD}」`, canvas.width - 24, top + 24);
      ctx.textAlign = 'left';
      const brand = brands[this.data.brandIndex] || brands[0]; ctx.font = '15px sans-serif'; ctx.fillStyle = '#58706e';
      ctx.fillText(`${width} × ${height} · ${summary.total} 颗 · ${summary.materials.length} 色 · ${brand.label} · ${brand.note}`, 24, top + 58);
      summary.materials.forEach((item, index) => {
        const col = index % columns, row = Math.floor(index / columns), x = 24 + col * Math.floor((canvas.width - 48) / columns), y = top + 98 + row * 38;
        ctx.fillStyle = `rgb(${item.r},${item.g},${item.b})`; ctx.fillRect(x, y - 13, 24, 24); ctx.strokeStyle = '#aab8b4'; ctx.strokeRect(x, y - 13, 24, 24);
        ctx.fillStyle = '#173d39'; ctx.font = '600 16px sans-serif'; ctx.fillText(`${item.code}  × ${item.count} 颗`, x + 34, y);
      });
      const codeX = canvas.width - miniProgramCodeSize - 24, codeY = top + 85;
      ctx.fillStyle = '#fff'; ctx.fillRect(codeX, codeY, miniProgramCodeSize, miniProgramCodeSize);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(miniProgramCode, codeX, codeY, miniProgramCodeSize, miniProgramCodeSize);
      ctx.strokeStyle = '#d2e2de'; ctx.lineWidth = 1; ctx.strokeRect(codeX, codeY, miniProgramCodeSize, miniProgramCodeSize);
      ctx.textAlign = 'left';
    }
    return { canvas, cell, header, originX, originY, width, height, summary, qrSafe, brandCodeLoaded: !includeLegend || !!miniProgramCode };
  },
  async renderPattern() {
    const drawn = await this.drawPattern();
    const file = await canvasToFile(this, drawn.canvas, { fileType: 'png', destWidth: drawn.canvas.width, destHeight: drawn.canvas.height });
    this._drawMeta = drawn;
    const resetView=this.data.stage!=='editor';
    this.setData({ previewPath: file.tempFilePath, materials: drawn.summary.materials, totalBeads: drawn.summary.total, resultWidth: drawn.width, resultHeight: drawn.height, replaceFromIndex: 0, replaceToIndex: 0,
      ...(resetView?{patternScale:1,patternZoom:100,patternMoveX:0,patternMoveY:0,patternEditLocked:true,patternViewReady:true}:{}) });
    return file.tempFilePath;
  },

  selectEditTool(event) { this.setData({ editTool: event.currentTarget.dataset.value }); },
  patternTouchPoint(touch){return{x:touch.clientX==null?(touch.x==null?touch.pageX:touch.x):touch.clientX,y:touch.clientY==null?(touch.y==null?touch.pageY:touch.y):touch.clientY};},
  patternTouchStart(event){const touches=event.touches||[];if(!touches.length)return;const point=this.patternTouchPoint(touches[0]);this._patternGesture={x:point.x,y:point.y,moved:false,multi:touches.length>1};if(touches.length>1)this._suppressPatternEditUntil=Date.now()+500;},
  patternTouchMove(event){const touches=event.touches||[],gesture=this._patternGesture;if(!touches.length||!gesture)return;const point=this.patternTouchPoint(touches[0]);if(touches.length>1||Math.hypot(point.x-gesture.x,point.y-gesture.y)>8){gesture.moved=true;gesture.multi=gesture.multi||touches.length>1;this._suppressPatternEditUntil=Date.now()+450;}},
  patternTouchEnd(){const gesture=this._patternGesture;if(gesture&&(gesture.moved||gesture.multi))this._suppressPatternEditUntil=Date.now()+450;this._patternGesture=null;},
  onPatternScale(event){const scale=Number(event.detail.scale)||1;this._patternCurrentScale=scale;this._suppressPatternEditUntil=Date.now()+500;this.setData({patternZoom:Math.round(scale*100)});},
  onPatternMove(event){this._patternCurrentX=Number(event.detail.x)||0;this._patternCurrentY=Number(event.detail.y)||0;if(event.detail.source==='touch')this._suppressPatternEditUntil=Date.now()+400;},
  resetPatternView(){this._suppressPatternEditUntil=Date.now()+500;this.setData({patternViewReady:false,patternScale:1,patternZoom:100,patternMoveX:0,patternMoveY:0},()=>wx.nextTick(()=>this.setData({patternViewReady:true})));},
  togglePatternEditLock(){const locked=!this.data.patternEditLocked;this._suppressPatternEditUntil=Date.now()+350;this.setData({patternEditLocked:locked,paletteOpen:locked?false:this.data.paletteOpen});wx.showToast({title:locked?'已锁定，只能缩放拖动':'已解锁，可以轻点改色',icon:'none'});},
  togglePalette() { this.setData({ paletteOpen: !this.data.paletteOpen }); },
  selectPaintColor(event) { this.setData({ selectedColorIndex: Number(event.currentTarget.dataset.index), editTool: 'paint', paletteOpen: false }); },
  pushChanges(changes) {
    if (!changes.length) return; this._undo.push(changes); if (this._undo.length > 80) this._undo.shift(); this._redo = [];
    this.setData({ undoAvailable: true, redoAvailable: false });
  },
  async editCell(event) {
    if (!this._pattern || this.data.patternEditLocked || Date.now()<(this._suppressPatternEditUntil||0)) return;
    const point = (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0]) || event.detail;
    wx.createSelectorQuery().in(this).select('#patternImage').boundingClientRect(async rect => {
      if (!rect || !point) return;
      const px = point.clientX == null ? (point.x == null ? point.pageX : point.x) : point.clientX;
      const py = point.clientY == null ? (point.y == null ? point.pageY : point.y) : point.clientY;
      const imageAspect=this._drawMeta.canvas.width/this._drawMeta.canvas.height,viewAspect=rect.width/rect.height;
      const shownWidth=imageAspect>=viewAspect?rect.width:rect.height*imageAspect,shownHeight=imageAspect>=viewAspect?rect.width/imageAspect:rect.height;
      const shownLeft=rect.left+(rect.width-shownWidth)/2,shownTop=rect.top+(rect.height-shownHeight)/2;
      if(px<shownLeft||py<shownTop||px>shownLeft+shownWidth||py>shownTop+shownHeight)return;
      const canvasX = (px - shownLeft) * this._drawMeta.canvas.width / shownWidth, canvasY = (py - shownTop) * this._drawMeta.canvas.height / shownHeight;
      const x = Math.floor((canvasX - this._drawMeta.originX) / this._drawMeta.cell), y = Math.floor((canvasY - this._drawMeta.originY) / this._drawMeta.cell);
      if (x < 0 || y < 0 || y >= this._pattern.length || x >= this._pattern[0].length) return;
      if (this._locked && this._locked[y] && this._locked[y][x]) { wx.showToast({ title: '这一格已在拼豆模式中锁定', icon: 'none' }); return; }
      const before = this._pattern[y][x];
      if (this.data.editTool === 'picker') {
        if (!before) return; const index = this._palette.findIndex(item => item[0] === before[0]);
        this.setData({ selectedColorIndex: Math.max(0, index), editTool: 'paint' }); return;
      }
      const after = this.data.editTool === 'erase' ? null : this._palette[this.data.selectedColorIndex];
      if ((before && after && before[0] === after[0]) || (!before && !after)) return;
      this._pattern[y][x] = after; this.pushChanges([{ x, y, before, after }]); await this.renderPattern();
    }).exec();
  },
  async applyChangeSet(changes, reverse) {
    changes.forEach(change => { this._pattern[change.y][change.x] = reverse ? change.before : change.after; }); await this.renderPattern();
  },
  async undo() { const changes = this._undo.pop(); if (!changes) return; await this.applyChangeSet(changes, true); this._redo.push(changes); this.setData({ undoAvailable: this._undo.length > 0, redoAvailable: true }); },
  async redo() { const changes = this._redo.pop(); if (!changes) return; await this.applyChangeSet(changes, false); this._undo.push(changes); this.setData({ undoAvailable: true, redoAvailable: this._redo.length > 0 }); },
  onReplacePicker(event) { this.setData({ [event.currentTarget.dataset.key]: Number(event.detail.value) }); },
  async replaceAll() {
    const from = this.data.materials[this.data.replaceFromIndex], to = this._palette[this.data.replaceToIndex]; if (!from || !to || from.code === to[0]) return;
    const changes = [];
    this._pattern.forEach((row, y) => row.forEach((color, x) => { if (color && color[0] === from.code && !(this._locked && this._locked[y] && this._locked[y][x])) { changes.push({ x, y, before: color, after: to }); this._pattern[y][x] = to; } }));
    this.pushChanges(changes); await this.renderPattern();
  },
  async savePng() {
    this.setData({ exportBusy: true });
    try {
      const drawn = await this.drawPattern({ includeLegend: true });
      if (!drawn.brandCodeLoaded) throw new Error('brand_code_not_loaded');
      const file = await canvasToFile(this, drawn.canvas, { fileType: 'png', quality: 1, destWidth: drawn.canvas.width, destHeight: drawn.canvas.height });
      await saveImage(file.tempFilePath); await this.renderPattern();
      this.setData({ status: '高清 PNG 已保存，图中包含材料清单、轻量署名和小程序码。', statusType: 'success' });
    } catch (error) {
      this.setData({
        status: /brand_code/.test(error && error.message)
          ? '小程序码加载失败，本次没有保存缺码图片，请重新进入页面后再试。'
          : '保存失败，请检查相册权限或尝试较小尺寸。',
        statusType: 'error'
      });
    }
    finally { this.setData({ exportBusy: false }); }
  },
  csvText() {
    const summary = this.recount(), brand = brands[this.data.brandIndex] || brands[0];
    const patternName = this.data.projectType === 'qr' ? normalizePatternName(this.data.patternName) : '';
    const lines = [
      ['SamVibe 拼豆图纸'],
      ...(patternName ? [['图纸名称', patternName]] : []),
      ['尺寸', `${this._pattern[0].length} × ${this._pattern.length}`],
      ['品牌', brand.label],
      ['总豆数', summary.total],
      ['色号数量', summary.materials.length],
      [],
      ['色号', '数量', 'R', 'G', 'B'],
      ...summary.materials.map(item => [item.code, item.count, item.r, item.g, item.b]),
      [],
      ['图纸坐标（首行为列号，首列为行号）', ...this._pattern[0].map((_, index) => index + 1)],
      ...this._pattern.map((row, index) => [index + 1, ...row.map(color => color ? color[0] : '')])
    ];
    return '\ufeff' + lines.map(row => row.map(value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  },
  async saveCsv() {
    this.setData({ exportBusy: true });
    try {
      const path = await writeUserFile('SamVibe-拼豆图纸.csv', this.csvText(), 'utf8');
      await shareFile(path, 'SamVibe-拼豆图纸.csv');
      this.setData({ status: 'CSV 材料表和坐标图纸已生成，可转发或保存。', statusType: 'success' });
    } catch (_) { this.setData({ status: 'CSV 生成失败，请稍后重试。', statusType: 'error' }); }
    finally { this.setData({ exportBusy: false }); }
  },
  async savePdf() {
    this.setData({ exportBusy: true });
    try {
      const drawn = await this.drawPattern({ includeLegend: true });
      if (!drawn.brandCodeLoaded) throw new Error('brand_code_not_loaded');
      const png = await canvasToFile(this, drawn.canvas, { fileType: 'png', quality: 1, destWidth: drawn.canvas.width, destHeight: drawn.canvas.height });
      PDFDocument = PDFDocument || require('pdf-lib').PDFDocument;
      const pdf = await PDFDocument.create(), image = await pdf.embedPng(await readArrayBuffer(png.tempFilePath));
      const maxSide = 1200, scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = image.width * scale, height = image.height * scale, margin = 24;
      const page = pdf.addPage([Math.max(200, width + margin * 2), Math.max(200, height + margin * 2)]);
      page.drawImage(image, { x: margin, y: margin, width, height });
      const pdfBytes = await pdf.save();
      const path = await writeUserFile('SamVibe-拼豆图纸.pdf', pdfBytes.buffer);
      await openDocument(path, 'pdf', true); await this.renderPattern();
      this.setData({ status: 'PDF 图纸已生成，右上角菜单可转发或保存。', statusType: 'success' });
    } catch (_) { this.setData({ status: 'PDF 生成失败，请尝试较小尺寸。', statusType: 'error' }); }
    finally { this.setData({ exportBusy: false }); }
  },

  serializePattern() { return this._pattern.map(row => row.map(color => color ? color[0] : '')); },
  async createHistoryThumbnail(pattern, palette, id) {
    if (!pattern || !pattern.length || !pattern[0].length) return '';
    const query = await queryCanvas(this, '#sampleCanvas'), canvas = query.node, size = 360, padding = 18;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'), rows = pattern.length, columns = pattern[0].length;
    const cell = Math.min((size - padding * 2) / columns, (size - padding * 2) / rows);
    const width = cell * columns, height = cell * rows, startX = (size - width) / 2, startY = (size - height) / 2;
    const colorMap = {}; (palette || []).forEach(color => { colorMap[color[0]] = color; });
    ctx.fillStyle = '#f0f1f3'; ctx.fillRect(0, 0, size, size);
    pattern.forEach((row, y) => row.forEach((value, x) => {
      const color = Array.isArray(value) ? value : colorMap[value];
      if (!color) return;
      ctx.fillStyle = `rgb(${color[2]},${color[3]},${color[4]})`;
      ctx.fillRect(startX + x * cell, startY + y * cell, Math.ceil(cell + .25), Math.ceil(cell + .25));
    }));
    const file = await canvasToFile(this, canvas, { fileType: 'jpg', quality: .82, destWidth: size, destHeight: size });
    return copyFile(file.tempFilePath, `bead-history-${id}.jpg`);
  },
  async ensureHistoryThumbnails() {
    if (this._historyThumbBusy || !this._pageReady) return;
    this._historyThumbBusy = true;
    try {
      const missing = history.list().filter(item => !item.thumbnailPath);
      for (const item of missing) {
        const project = history.load(item.id);
        if (!project || !project.cells || !project.cells.length) continue;
        try {
          const palette = getPalette(project.brand || 'mard', project.packageSize);
          const thumbnailPath = await this.createHistoryThumbnail(project.cells, palette, item.id);
          if (thumbnailPath) history.update(item.id, { thumbnailPath });
        } catch (_) {}
      }
      this.refreshHistory();
    } finally { this._historyThumbBusy = false; }
  },
  async saveCurrentProject(title, type) {
    if (!this._pattern) return;
    const brand = brands[this.data.brandIndex] || brands[0], packageOption = this.data.packageOptions[this.data.packageIndex];
    const patternName = type === 'qr' ? normalizePatternName(this.data.patternName) : '';
    const project = { type, title: patternName || title, patternName, width: this._pattern[0].length, height: this._pattern.length, brand: brand.value, packageSize: packageOption ? packageOption.value : brand.count, cells: this.serializePattern(), locked: this._locked || null };
    const summary = history.save(project);
    try {
      const thumbnailPath = await this.createHistoryThumbnail(this._pattern, this._palette, summary.id);
      if (thumbnailPath) history.update(summary.id, { thumbnailPath });
    } catch (_) {}
    this.refreshHistory();
  },
  refreshHistory() { this.setData({ historyItems: history.list().map(item => ({ ...item, dateLabel: formatDate(item.createdAt), typeLabel: historyTypeLabel(item.type) })) }); },
  async openHistory(event) {
    const project = history.load(event.currentTarget.dataset.id); if (!project) return;
    const brandIndex = Math.max(0, brands.findIndex(item => item.value === project.brand)), brand = brands[brandIndex];
    const options = getPackageOptions(brand.value), packageIndex = Math.max(0, options.findIndex(item => item.value === project.packageSize));
    this._palette = getPalette(brand.value, project.packageSize); const map = {}; this._palette.forEach(item => { map[item[0]] = item; });
    this._pattern = project.cells.map(row => row.map(code => {
      if (!code) return null;
      const normalizedCode = brand.value === 'mard' ? code.replace(/^([A-Z]+)0+(\d+)$/, '$1$2') : code;
      return map[normalizedCode] || null;
    })); this._locked = project.locked || Array.from({ length: this._pattern.length }, () => Array(this._pattern[0].length).fill(false)); this._undo = []; this._redo = [];
    this.setData({ brandIndex, packageOptions: options, packageIndex, paletteColors: this.paletteView(this._palette), selectedColorIndex: 0, patternName: normalizePatternName(project.patternName || (project.type === 'qr' && project.title !== '二维码图纸' ? project.title : '')), patternReady: true, status: '已恢复本地图纸，可继续编辑。', statusType: 'success', projectType: project.type || 'photo' });
    await this.renderPattern(); this.setStage('editor');
  },
  showHistoryMenu(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({ itemList: ['打开图纸', '删除图纸'], success: result => {
      if (result.tapIndex === 0) this.openHistory({ currentTarget: { dataset: { id } } });
      if (result.tapIndex === 1) {
        wx.showModal({ title: '删除图纸', content: '确定删除这张本地图纸吗？', confirmColor: '#d9668f', success: modal => { if (modal.confirm) { history.remove(id); this.refreshHistory(); } } });
      }
    } });
  },
  deleteHistory(event) { history.remove(event.currentTarget.dataset.id); this.refreshHistory(); },
  clearHistory() {
    wx.showModal({ title: '清空历史图纸', content: '将删除本机保存的全部拼豆图纸，此操作不能撤销。', success: result => { if (result.confirm) { history.clear(); this.refreshHistory(); } } });
  }
});
