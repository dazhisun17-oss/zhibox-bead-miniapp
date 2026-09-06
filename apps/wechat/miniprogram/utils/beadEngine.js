const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function srgb(value) {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4);
}

function rgbToLab(rgb) {
  const r = srgb(rgb[0]), g = srgb(rgb[1]), b = srgb(rgb[2]);
  let x = (r * .4124564 + g * .3575761 + b * .1804375) / .95047;
  let y = (r * .2126729 + g * .7151522 + b * .072175) / 1;
  let z = (r * .0193339 + g * .119192 + b * .9503041) / 1.08883;
  const pivot = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  x = pivot(x); y = pivot(y); z = pivot(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function perceptualDistance(pixelLab, colorLab) {
  const dl = pixelLab[0] - colorLab[0];
  const da = pixelLab[1] - colorLab[1];
  const db = pixelLab[2] - colorLab[2];
  let score = dl * dl * 1.15 + da * da + db * db;
  const pixelChroma = Math.hypot(pixelLab[1], pixelLab[2]);
  const colorChroma = Math.hypot(colorLab[1], colorLab[2]);
  // 色卡匹配不能只追求明度接近。高彩度的青、粉、黄若被映射到面积更大的
  // 灰青/灰粉，少色图就会整体发灰。对明显的“掉饱和”增加代价，同时不把
  // 原本柔和的肤色和浅灰反向强行染艳。
  if (pixelChroma > 18 && colorChroma + 5 < pixelChroma) {
    const chromaLoss = pixelChroma - colorChroma - 5;
    score += chromaLoss * chromaLoss * .9;
  }
  // 纯白只服务于真正的白底与眼睛高光。人物手里的纸卡、米白衣服、
  // 冷白发丝等“前景浅白”仍要匹配米白/浅灰/浅蓝色号，不能全部压成 H2。
  if (colorLab[0] > 98 && colorChroma < 4 && (pixelLab[0] < 96.5 || pixelChroma > 5.5)) score += 880;
  // 真黑只服务于原图中的真黑和结构线。过去中暗灰、棕色头发和衣服阴影也
  // 很容易落到 H7，缩小后便糊成整块黑色。对仍有可见亮度的像素增加“压黑”
  // 代价，优先选择同色系的深灰/深棕；实际黑色和近黑抗锯齿不受影响。
  if (colorLab[0] < 14 && colorChroma < 12 && pixelLab[0] > 28) {
    const shadowGap = pixelLab[0] - 28;
    score += shadowGap * shadowGap * 2.15;
  }
  return score;
}

function preparePalette(palette) {
  return palette.map(color => ({ color, lab: rgbToLab([color[2], color[3], color[4]]) }));
}

function nearest(pixel, palette, prepared) {
  const candidates = prepared || preparePalette(palette), pixelLab = rgbToLab(pixel);
  let best = candidates[0], score = Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const current = perceptualDistance(pixelLab, candidates[i].lab);
    if (current < score) { score = current; best = candidates[i]; }
  }
  return best.color;
}

function isExtremePureWhite(colorLab) {
  return colorLab[0] > 98 && Math.hypot(colorLab[1], colorLab[2]) < 4.5;
}

function labDistance(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl * 1.15 + da * da + db * db;
}

function labHue(lab) {
  let hue = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
  if (hue < 0) hue += 360;
  return hue;
}

function hueDifference(a, b) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 360 - difference);
}

function hueFamily(hue) {
  if (hue < 45 || hue >= 335) return 'red-pink';
  if (hue < 80) return 'orange';
  if (hue < 115) return 'yellow';
  if (hue < 175) return 'green';
  if (hue < 245) return 'cyan';
  if (hue < 305) return 'blue';
  return 'purple';
}

// “智能复用”需要比抗锯齿去重更进一步：同一个橙色、粉色、绿色区域里，
// 轻微的光照和缩放差异不应该让用户多找几个几乎一样的色号。这里按色相、
// 明度和彩度共同判断颜色家族；阈值刻意保留明显的高光/阴影层次，也不会把
// 彩色合进灰色，或把不同色相只因明度相近而合并。
function reusableColorFamily(a, b, longSide = 52) {
  const lightnessGap = Math.abs(a[0] - b[0]);
  const chromaA = Math.hypot(a[1], a[2]), chromaB = Math.hypot(b[1], b[2]);
  const chromaGap = Math.abs(chromaA - chromaB);
  const small = longSide <= 52, medium = longSide <= 84;

  // 智能模式目标是手工整理过的大色块：黑色边框统一为黑色，同一块白、灰、
  // 肤色、头发或衣服不因抗锯齿和轻微光照拆成许多近似色。极暗结构仍与
  // 普通灰阶分开，防止眼睛、嘴巴和外框融进浅灰填色。
  if (chromaA <= 10 && chromaB <= 10) {
    if (Math.min(a[0], b[0]) < 25 && Math.max(a[0], b[0]) >= 40) return false;
    const neutralLimit = Math.min(a[0], b[0]) < 28 ? (small ? 11 : (medium ? 9 : 8)) : (small ? 18 : (medium ? 15 : 13));
    return lightnessGap <= neutralLimit;
  }
  // 一个明确彩色、一个中性颜色时绝不合并。
  if ((chromaA <= 11 && chromaB >= 18) || (chromaB <= 11 && chromaA >= 18)) return false;
  const lightnessLimit = small ? 23 : (medium ? 19 : 16);
  const chromaLimit = small ? 32 : (medium ? 28 : 24);
  if (lightnessGap > lightnessLimit || chromaGap > chromaLimit) return false;

  // 红、橙、黄、绿、青、蓝、紫、粉使用同一套圆形色相距离，不再只给暖色
  // 更宽的合并范围。26° 会把同一物体的近似色统一成面积最大的主色，又不
  // 跨越一个完整主色系；超过 22 级明度差的明确高光/阴影仍单独保留。
  const hueGap = hueDifference(labHue(a), labHue(b));
  const hueLimit = small ? 24 : (medium ? 22 : 20);
  const distanceLimit = small ? 980 : (medium ? 760 : 600);
  return hueFamily(labHue(a)) === hueFamily(labHue(b)) && hueGap <= hueLimit && labDistance(a, b) <= distanceLimit;
}

// 连续色块的判定要比“全图复用同色”更谨慎。它只把同一物体内部由缩放、
// 抗锯齿和柔和光照产生的近似色连成一个块；明显的高光、阴影和不同色相仍
// 会形成独立色块。小图允许稍宽的容差，让 32/52 格更接近人工整理图纸。
function sameLargeBlockColor(a, b, longSide) {
  const lightnessGap = Math.abs(a[0] - b[0]);
  const chromaA = Math.hypot(a[1], a[2]), chromaB = Math.hypot(b[1], b[2]);
  const chromaGap = Math.abs(chromaA - chromaB);
  const small = longSide <= 52, medium = longSide <= 84;
  if (chromaA <= 12 && chromaB <= 12) {
    if (Math.min(a[0], b[0]) < 24 && Math.max(a[0], b[0]) >= 39) return false;
    const limit = small ? 18 : (medium ? 15 : 12);
    return lightnessGap <= limit && labDistance(a, b) <= (small ? 560 : (medium ? 430 : 330));
  }
  if ((chromaA <= 11 && chromaB >= 18) || (chromaB <= 11 && chromaA >= 18)) return false;
  return hueFamily(labHue(a)) === hueFamily(labHue(b))
    && lightnessGap <= (small ? 22 : (medium ? 18 : 15))
    && chromaGap <= (small ? 31 : (medium ? 27 : 23))
    && hueDifference(labHue(a), labHue(b)) <= (small ? 24 : (medium ? 21 : 18))
    && labDistance(a, b) <= (small ? 850 : (medium ? 650 : 500));
}

function adjustPixel(pixel, options) {
  let [r, g, b] = pixel;
  const brightness = (Number(options.brightness || 100) - 100) * 2.55;
  const contrast = Number(options.contrast || 100) / 100;
  const saturation = Number(options.saturation || 100) / 100 * Number(options.accentBoost || 1);
  r = (r + brightness - 128) * contrast + 128;
  g = (g + brightness - 128) * contrast + 128;
  b = (b + brightness - 128) * contrast + 128;
  const gray = r * .299 + g * .587 + b * .114;
  return [
    clamp(Math.round(gray + (r - gray) * saturation), 0, 255),
    clamp(Math.round(gray + (g - gray) * saturation), 0, 255),
    clamp(Math.round(gray + (b - gray) * saturation), 0, 255)
  ];
}

function estimateBorderBackground(data, width, height, options = {}) {
  const points = [], inset = Math.max(1, Math.min(2, Math.floor(Math.min(width, height) / 20)));
  const add = (x, y) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] > 24) points.push([data[index], data[index + 1], data[index + 2]]);
  };
  // 采集整条画布边缘，不再只平均四个角。半身人像的头发、手臂常会占住
  // 底角或侧角，旧算法因此把黑发与白底平均成杂色并直接放弃去背景。
  for (let band = 0; band < inset; band += 1) {
    for (let x = band; x < width - band; x += 1) { add(x, band); if (height - 1 - band !== band) add(x, height - 1 - band); }
    for (let y = band + 1; y < height - 1 - band; y += 1) { add(band, y); if (width - 1 - band !== band) add(width - 1 - band, y); }
  }
  if (!points.length) return null;

  // 在边缘颜色中找最稳定的主色簇。它允许主体占住部分边缘，但不会让
  // 那些前景颜色拉偏真正的白底/纯色底。
  const clusterRadiusSquared = 32 * 32, seedStep = Math.max(1, Math.floor(points.length / 96));
  let best = null, bestLight = null;
  for (let seedIndex = 0; seedIndex < points.length; seedIndex += seedStep) {
    const seed = points[seedIndex], members = points.filter(point => rgbDistance(point, seed) <= clusterRadiusSquared);
    if (!members.length) continue;
    const color = [0, 1, 2].map(channel => Math.round(members.reduce((sum, point) => sum + point[channel], 0) / members.length));
    const spread = members.reduce((sum, point) => sum + Math.sqrt(rgbDistance(point, color)), 0) / members.length;
    const candidate = { color, spread, count: members.length };
    if (!best || candidate.count > best.count || (candidate.count === best.count && candidate.spread < best.spread)) best = candidate;
    const luminance = color[0] * .299 + color[1] * .587 + color[2] * .114;
    const neutralRange = Math.max(...color) - Math.min(...color);
    if (luminance >= 218 && neutralRange <= 34 && (!bestLight || candidate.count > bestLight.count || (candidate.count === bestLight.count && candidate.spread < bestLight.spread))) bestLight = candidate;
  }
  // AI“仅保留主体”已约定使用纯白画布。即使黑发覆盖了更多底边，只要边缘仍
  // 有足够的浅色背景证据，也必须优先把它识别为背景，不能反过来删黑发。
  const lightCoverage = bestLight ? bestLight.count / points.length : 0;
  const selected = options.backgroundMode === 'subject' && bestLight && lightCoverage >= .1 ? bestLight : best;
  if (!selected || selected.count / points.length < .12 || selected.spread > 34) return null;
  return { color: selected.color, threshold: clamp(22 + selected.spread * .8, 22, 46) };
}

function rgbDistance(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * .28 + dg * dg * .55 + db * db * .17;
}

function connectedBackgroundMask(data, width, height, options = {}) {
  const estimate = estimateBorderBackground(data, width, height, options);
  if (!estimate) return null;
  const mask = new Uint8Array(width * height), barrier = new Uint8Array(width * height), queue = [], thresholdSquared = estimate.threshold * estimate.threshold;
  // 对文字、Logo 和硬边图形，背景色即使被字母/汉字围成孔洞也仍是背景。
  // 这类素材没有“白毛或白衣被黑边包住”的歧义，可以按全图背景色直接清除，
  // 从而保住 O、e、a 以及中文字形中的真实负空间。
  if (options.sourceKind === 'graphic') {
    for (let position = 0; position < width * height; position += 1) {
      const index = position * 4;
      if (data[index + 3] < 24 || rgbDistance([data[index], data[index + 1], data[index + 2]], estimate.color) <= thresholdSquared) mask[position] = 1;
    }
    return mask;
  }
  // 先把明显的主体像素向四周扩展作为“防洪墙”。高分辨率预处理时
  // 用 2–3 像素墙闭合浅色衣服、白毛与白底之间的细小描边断口；低分辨率
  // 直接映射仍保持一格，避免防洪墙反过来吞掉太多外部留白。
  const barrierRadius = clamp(Number(options.backgroundBarrierRadius || 1), 1, 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const position = y * width + x, index = position * 4;
    if (data[index + 3] < 24) continue;
    const pixel = [data[index], data[index + 1], data[index + 2]];
    const backgroundLight = estimate.color[0] * .299 + estimate.color[1] * .587 + estimate.color[2] * .114;
    // “像素很暗”只有在背景本身很亮时才是可靠的主体证据。旧规则无条件把
    // 亮度低于 190 的像素设成防洪墙，纯黑背景因此整块都无法被洪泛删除。
    const darkAgainstLightBackground = backgroundLight >= 205 && sourceLuminance(data, width, height, x, y) < 190;
    const obviousForeground = rgbDistance(pixel, estimate.color) > thresholdSquared * 2.1 || darkAgainstLightBackground;
    if (!obviousForeground) continue;
    for (let dy = -barrierRadius; dy <= barrierRadius; dy += 1) for (let dx = -barrierRadius; dx <= barrierRadius; dx += 1) {
      const nearX = x + dx, nearY = y + dy;
      if (nearX >= 0 && nearY >= 0 && nearX < width && nearY < height && dx * dx + dy * dy <= barrierRadius * barrierRadius + 1) barrier[nearY * width + nearX] = 1;
    }
  }
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const position = y * width + x;
    if (mask[position] || barrier[position]) return;
    const index = position * 4;
    if (data[index + 3] < 24 || rgbDistance([data[index], data[index + 1], data[index + 2]], estimate.color) <= thresholdSquared) {
      mask[position] = 1; queue.push(position);
    }
  };
  for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
  for (let head = 0; head < queue.length; head += 1) {
    const position = queue[head], x = position % width, y = Math.floor(position / width);
    enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
  }
  // 防洪墙外侧仍属于背景：洪泛结束后只吸收直接接触外部背景的浅色墙格，
  // 不继续传播，因此不会再次从描边缺口灌入主体内部。
  const exterior = mask.slice();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const position = y * width + x;
    if (!barrier[position] || mask[position]) continue;
    const index = position * 4, pixel = [data[index], data[index + 1], data[index + 2]];
    if (data[index + 3] >= 24 && rgbDistance(pixel, estimate.color) > thresholdSquared) continue;
    const touchesExterior = [[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy]) => {
      const nearX = x + dx, nearY = y + dy;
      return nearX >= 0 && nearY >= 0 && nearX < width && nearY < height && exterior[nearY * width + nearX];
    });
    if (touchesExterior) mask[position] = 1;
  }
  return mask;
}

// 先在高分辨率上分离主体与背景，再把主体缩成豆格。这个顺序是白衣、
// 白毛和浅色卡通能否保持完整的关键：如果先缩到 32/52 格，细描边会被
// 白底平均掉，之后无论怎么“恢复空洞”都无法知道哪一片白是主体。
//
// 返回的 alpha 已经是可直接交给 mapPixels 的前景遮罩。同时利用前景包围盒把
// AI 图中过多的空白边缘压缩到约一格安全距离，让宠物、Q 版角色在 52×52
// 真正用足面积，而不是只占画布中央一小块。
function prepareSubjectSample(data, sourceWidth, sourceHeight, targetWidth, targetHeight, options = {}) {
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) return { data, width: targetWidth, height: targetHeight };
  // 二维码不能像普通照片一样做面积平均：QR 的一个逻辑模块一旦被缩成
  // 1.3 或 1.7 个豆格，黑白边界就会在每一行落到不同位置，画面看起来像
  // 二维码却无法扫码。先识别定位框、版本和模块矩阵，再用整数格重新铺图。
  const canDetectQr = options.detectQrStructure !== false
    && (!options.sourceKind || options.sourceKind === 'auto' || options.sourceKind === 'binary');
  const qrStructure = canDetectQr ? analyzeQrStructure(data, sourceWidth, sourceHeight) : null;
  const qrSample = qrStructure ? renderQrStructure(qrStructure, targetWidth, targetHeight) : null;
  if (qrSample) return qrSample;
  const sourceKind = inferSourceKind(data, sourceWidth, sourceHeight, options);
  // 二维码和硬边双色图的浅色区域也是功能图形的一部分，不能按普通主体图
  // 当作“白色背景”提前挖空。双色分流会在缩放后统一把抗锯齿归回两个主色。
  const background = options.localBackground === false || sourceKind === 'binary'
    ? null
    : connectedBackgroundMask(data, sourceWidth, sourceHeight, {
      ...options,
      sourceKind,
      backgroundBarrierRadius: Number(options.backgroundBarrierRadius || (Math.max(sourceWidth, sourceHeight) >= 128 ? 3 : 2))
    });
  const foreground = new Uint8Array(sourceWidth * sourceHeight);
  let minX = sourceWidth, minY = sourceHeight, maxX = -1, maxY = -1, foregroundCount = 0;
  for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
    const position = y * sourceWidth + x, index = position * 4;
    if (data[index + 3] < 24 || (background && background[position])) continue;
    foreground[position] = 1; foregroundCount += 1;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }

  // 背景不稳定时保守使用整幅图，但仍使用 alpha 感知缩放，避免透明边缘
  // 被白色或黑色背景污染。
  if (!foregroundCount || maxX < minX || maxY < minY) {
    minX = 0; minY = 0; maxX = sourceWidth - 1; maxY = sourceHeight - 1;
    for (let position = 0; position < foreground.length; position += 1) foreground[position] = data[position * 4 + 3] >= 24 ? 1 : 0;
  }

  const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
  // 保留约 4% 原始主体尺寸的安全边，至少为高分辨率图中的 2 像素。
  const sourcePadding = Math.max(2, Math.round(Math.max(boxWidth, boxHeight) * .04));
  minX = Math.max(0, minX - sourcePadding); minY = Math.max(0, minY - sourcePadding);
  maxX = Math.min(sourceWidth - 1, maxX + sourcePadding); maxY = Math.min(sourceHeight - 1, maxY + sourcePadding);
  const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;
  const targetPadding = sourceKind === 'binary' ? 0 : (sourceKind === 'graphic' ? 1 : Math.max(1, Math.round(Math.max(targetWidth, targetHeight) * .035)));
  const scale = Math.min(
    Math.max(1, targetWidth - targetPadding * 2) / cropWidth,
    Math.max(1, targetHeight - targetPadding * 2) / cropHeight
  );
  const drawWidth = cropWidth * scale, drawHeight = cropHeight * scale;
  const offsetX = (targetWidth - drawWidth) / 2, offsetY = (targetHeight - drawHeight) / 2;
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
    const sourceLeft = minX + (x - offsetX) / scale;
    const sourceTop = minY + (y - offsetY) / scale;
    const sourceRight = minX + (x + 1 - offsetX) / scale;
    const sourceBottom = minY + (y + 1 - offsetY) / scale;
    if (sourceRight <= minX || sourceBottom <= minY || sourceLeft >= maxX + 1 || sourceTop >= maxY + 1) continue;
    const startX = clamp(Math.floor(sourceLeft), minX, maxX), endX = clamp(Math.ceil(sourceRight) - 1, minX, maxX);
    const startY = clamp(Math.floor(sourceTop), minY, maxY), endY = clamp(Math.ceil(sourceBottom) - 1, minY, maxY);
    let samples = 0, solid = 0, sumR = 0, sumG = 0, sumB = 0, darkest = 256, darkR = 0, darkG = 0, darkB = 0;
    for (let sampleY = startY; sampleY <= endY; sampleY += 1) for (let sampleX = startX; sampleX <= endX; sampleX += 1) {
      samples += 1;
      const sourcePosition = sampleY * sourceWidth + sampleX, sourceIndex = sourcePosition * 4;
      if (!foreground[sourcePosition]) continue;
      solid += 1; sumR += data[sourceIndex]; sumG += data[sourceIndex + 1]; sumB += data[sourceIndex + 2];
      const light = data[sourceIndex] * .299 + data[sourceIndex + 1] * .587 + data[sourceIndex + 2] * .114;
      if (light < darkest) { darkest = light; darkR = data[sourceIndex]; darkG = data[sourceIndex + 1]; darkB = data[sourceIndex + 2]; }
    }
    // 只要一个豆格中有足够前景证据就保留，以避免天线、手指、尾巴和斜向
    // 轮廓在缩小时整格消失；孤立噪点会在后续的主体连通性检查中被剔除。
    const coverage = samples ? solid / samples : 0;
    if (!solid || coverage < (sourceKind === 'graphic' ? .1 : .12)) continue;
    let r = sumR / solid, g = sumG / solid, b = sumB / solid;
    const averageLight = r * .299 + g * .587 + b * .114;
    // AI 平滑插画里的鼻子、嘴巴、眉毛和眼镜框经常只占一个豆格内的
    // 2～4 个高分辨率子像素。直接平均会把这些线混进肤色，随后即使颜色
    // 匹配再准确也无法恢复五官。这里仅对“亮色填充中的连续深色证据”做
    // 覆盖感知采样：至少需要两个子像素（2× 采样时为一个）且明暗差足够，
    // 才将该格拉回深色结构。均匀黑发、黑衣和孤立 JPEG 暗点不会触发。
    let featureCount = 0, featureR = 0, featureG = 0, featureB = 0;
    const featureLimit = Math.min(138, averageLight - 42);
    if (sourceKind === 'illustration' && averageLight >= 148 && featureLimit >= 36) {
      for (let sampleY = startY; sampleY <= endY; sampleY += 1) for (let sampleX = startX; sampleX <= endX; sampleX += 1) {
        const sourcePosition = sampleY * sourceWidth + sampleX, sourceIndex = sourcePosition * 4;
        if (!foreground[sourcePosition]) continue;
        const light = data[sourceIndex] * .299 + data[sourceIndex + 1] * .587 + data[sourceIndex + 2] * .114;
        if (light > featureLimit) continue;
        featureCount += 1; featureR += data[sourceIndex]; featureG += data[sourceIndex + 1]; featureB += data[sourceIndex + 2];
      }
    }
    const featureCoverage = solid ? featureCount / solid : 0;
    const minimumFeatureSamples = samples >= 9 ? 2 : 1;
    if (featureCount >= minimumFeatureSamples && featureCoverage >= .1 && featureCoverage <= .58) {
      const strength = clamp(.62 + featureCoverage * .55, .66, .76);
      r = r * (1 - strength) + featureR / featureCount * strength;
      g = g * (1 - strength) + featureG / featureCount * strength;
      b = b * (1 - strength) + featureB / featureCount * strength;
    }
    // 一格中的深色描边占比明显时才小幅拉回深色；不再让一个 JPEG 暗点
    // 把整格染黑。
    if (!featureCount && darkest <= Math.min(135, averageLight - 35) && coverage >= .28) {
      const strength = clamp((coverage - .25) * .24, 0, .12);
      r = r * (1 - strength) + darkR * strength;
      g = g * (1 - strength) + darkG * strength;
      b = b * (1 - strength) + darkB * strength;
    }
    const target = (y * targetWidth + x) * 4;
    output[target] = Math.round(r); output[target + 1] = Math.round(g); output[target + 2] = Math.round(b); output[target + 3] = 255;
  }
  return { data: output, width: targetWidth, height: targetHeight, sourceKind, foregroundBounds: { minX, minY, maxX, maxY } };
}

function otsuLuminanceThreshold(data) {
  const histogram = new Uint32Array(256);
  let total = 0, weighted = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 24) continue;
    const light = clamp(Math.round(data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114), 0, 255);
    histogram[light] += 1; total += 1; weighted += light;
  }
  if (total < 64) return 128;
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 128;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weighted - backgroundSum) / foregroundWeight;
    const between = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (between > bestVariance) { bestVariance = between; threshold = value; }
  }
  return clamp(threshold, 48, 220);
}

function qrFinderExpected(row, column) {
  return row === 0 || row === 6 || column === 0 || column === 6
    || (row >= 2 && row <= 4 && column >= 2 && column <= 4);
}

function qrSampleIsDark(data, width, height, x, y, threshold, radius = 0) {
  const left = clamp(Math.floor(x - radius), 0, width - 1), right = clamp(Math.ceil(x + radius), 0, width - 1);
  const top = clamp(Math.floor(y - radius), 0, height - 1), bottom = clamp(Math.ceil(y + radius), 0, height - 1);
  let light = 0, count = 0;
  for (let sampleY = top; sampleY <= bottom; sampleY += 1) for (let sampleX = left; sampleX <= right; sampleX += 1) {
    const index = (sampleY * width + sampleX) * 4;
    if (data[index + 3] < 24) continue;
    light += data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
    count += 1;
  }
  return count ? light / count <= threshold : false;
}

// 识别正向、近似正方形的标准 QR。这里不尝试“看起来像二维码”的模糊分类，
// 而是逐个验证 21、25、29…177 模块的合法尺寸，并检查三个 7×7 定位框、
// 白色分隔带和横纵时序线。普通黑白 Logo 即使也是两个颜色，也过不了这些
// 结构约束，因此不会被错误重排。
function analyzeQrStructure(data, width, height) {
  if (!width || !height || Math.min(width, height) < 42) return null;
  const threshold = otsuLuminanceThreshold(data);
  const rowDark = new Uint32Array(height), columnDark = new Uint32Array(width);
  let darkPixels = 0, darkR = 0, darkG = 0, darkB = 0;
  let lightPixels = 0, lightR = 0, lightG = 0, lightB = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) continue;
    const light = data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
    if (light <= threshold) {
      rowDark[y] += 1; columnDark[x] += 1; darkPixels += 1;
      darkR += data[index]; darkG += data[index + 1]; darkB += data[index + 2];
    } else {
      lightPixels += 1; lightR += data[index]; lightG += data[index + 1]; lightB += data[index + 2];
    }
  }
  if (darkPixels < 80 || !lightPixels) return null;
  const projectionFloor = Math.max(2, Math.round(Math.min(width, height) * .008));
  let minX = 0, maxX = width - 1, minY = 0, maxY = height - 1;
  while (minX < width && columnDark[minX] < projectionFloor) minX += 1;
  while (maxX >= 0 && columnDark[maxX] < projectionFloor) maxX -= 1;
  while (minY < height && rowDark[minY] < projectionFloor) minY += 1;
  while (maxY >= 0 && rowDark[maxY] < projectionFloor) maxY -= 1;
  if (maxX <= minX || maxY <= minY) return null;
  const baseWidth = maxX - minX + 1, baseHeight = maxY - minY + 1;
  const aspect = baseWidth / baseHeight;
  if (aspect < .84 || aspect > 1.19) return null;
  const coverage = darkPixels / Math.max(1, baseWidth * baseHeight);
  if (coverage < .12 || coverage > .72) return null;

  let best = null;
  for (let moduleCount = 21; moduleCount <= 177; moduleCount += 4) {
    const moduleWidth = baseWidth / moduleCount, moduleHeight = baseHeight / moduleCount;
    if (Math.min(moduleWidth, moduleHeight) < 1.05) break;
    const radius = Math.max(0, Math.min(moduleWidth, moduleHeight) * .12);
    const darkAt = (row, column) => qrSampleIsDark(
      data, width, height,
      minX + (column + .5) * moduleWidth,
      minY + (row + .5) * moduleHeight,
      threshold, radius
    );
    const finderOrigins = [[0, 0], [0, moduleCount - 7], [moduleCount - 7, 0]];
    let finderErrors = 0, finderChecks = 0, worstFinder = 0;
    finderOrigins.forEach(([originY, originX]) => {
      let errors = 0;
      for (let row = 0; row < 7; row += 1) for (let column = 0; column < 7; column += 1) {
        if (darkAt(originY + row, originX + column) !== qrFinderExpected(row, column)) errors += 1;
      }
      finderErrors += errors; finderChecks += 49; worstFinder = Math.max(worstFinder, errors / 49);
    });
    let separatorErrors = 0, separatorChecks = 0;
    const checkLight = (row, column) => {
      if (row < 0 || column < 0 || row >= moduleCount || column >= moduleCount) return;
      separatorChecks += 1; if (darkAt(row, column)) separatorErrors += 1;
    };
    for (let value = 0; value <= 7; value += 1) {
      checkLight(7, value); checkLight(value, 7);
      checkLight(7, moduleCount - 1 - value); checkLight(value, moduleCount - 8);
      checkLight(moduleCount - 8, value); checkLight(moduleCount - 1 - value, 7);
    }
    let timingErrors = 0, timingChecks = 0;
    for (let value = 8; value < moduleCount - 8; value += 1) {
      const expected = value % 2 === 0;
      timingChecks += 2;
      if (darkAt(6, value) !== expected) timingErrors += 1;
      if (darkAt(value, 6) !== expected) timingErrors += 1;
    }
    const finderMismatch = finderErrors / Math.max(1, finderChecks);
    const separatorMismatch = separatorErrors / Math.max(1, separatorChecks);
    const timingMismatch = timingErrors / Math.max(1, timingChecks);
    const score = finderMismatch * .72 + separatorMismatch * .1 + timingMismatch * .18;
    if (worstFinder > .2 || finderMismatch > .135 || separatorMismatch > .34 || timingMismatch > .48) continue;
    if (!best || score < best.score) {
      const modules = Array.from({ length: moduleCount }, (_, row) =>
        Array.from({ length: moduleCount }, (_, column) => darkAt(row, column))
      );
      best = {
        score, moduleCount, modules, threshold,
        bounds: { minX, minY, maxX, maxY },
        finderMismatch, separatorMismatch, timingMismatch,
        centers: [
          [darkR / darkPixels, darkG / darkPixels, darkB / darkPixels],
          [lightR / lightPixels, lightG / lightPixels, lightB / lightPixels]
        ]
      };
    }
  }
  return best && best.score <= .16 ? best : null;
}

function renderQrStructure(structure, targetWidth, targetHeight) {
  const count = structure && structure.moduleCount;
  if (!count || Math.min(targetWidth, targetHeight) < count) return null;
  const available = Math.min(targetWidth, targetHeight);
  // 优先保证四模块静区；放不下时仍保持每个逻辑模块恰好对应整数个豆格，
  // 绝不再使用会破坏定位框和时序线的非整数缩放。
  const scale = Math.max(1, Math.floor(available / (count + 8)));
  const drawingWidth = count * scale, offsetX = Math.floor((targetWidth - drawingWidth) / 2), offsetY = Math.floor((targetHeight - drawingWidth) / 2);
  if (offsetX < 1 || offsetY < 1) return null;
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const dark = structure.centers[0], light = structure.centers[1];
  for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
    const moduleX = Math.floor((x - offsetX) / scale), moduleY = Math.floor((y - offsetY) / scale);
    const isDark = moduleX >= 0 && moduleY >= 0 && moduleX < count && moduleY < count && structure.modules[moduleY][moduleX];
    const color = isDark ? dark : light, index = (y * targetWidth + x) * 4;
    output[index] = Math.round(color[0]); output[index + 1] = Math.round(color[1]); output[index + 2] = Math.round(color[2]); output[index + 3] = 255;
  }
  return {
    data: output,
    width: targetWidth,
    height: targetHeight,
    sourceKind: 'binary',
    qrStructure: true,
    qrModuleCount: count,
    qrScale: scale,
    qrQuietZone: Math.min(offsetX, offsetY) / scale
  };
}

// 识别“本来就只有两个稳定颜色、但因缩放/JPEG 产生了少量过渡色”的功能
// 图形。与简单统计颜色数相比，两簇模型会把黑白边缘的灰色视为过渡误差；
// 同时要求两簇距离大、簇内离散小并存在足够硬边。尤其不能让“大面积白底 +
// 深色制服/主体”把肤色、金色配饰和阴影都塞进一个宽松深色簇后误判为双色。
function analyzeTwoColorStructure(data, width, height) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 96));
  const samples = [];
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) continue;
    samples.push({ x, y, rgb: [data[index], data[index + 1], data[index + 2]] });
  }
  if (samples.length < 24) return null;
  const ordered = samples.slice().sort((a, b) => {
    const lightA = a.rgb[0] * .299 + a.rgb[1] * .587 + a.rgb[2] * .114;
    const lightB = b.rgb[0] * .299 + b.rgb[1] * .587 + b.rgb[2] * .114;
    return lightA - lightB;
  });
  const seedCount = Math.max(2, Math.floor(ordered.length * .08));
  let centers = [ordered.slice(0, seedCount), ordered.slice(-seedCount)].map(group => [0, 1, 2].map(channel =>
    group.reduce((sum, sample) => sum + sample.rgb[channel], 0) / group.length
  ));
  let assignments = new Uint8Array(samples.length);
  for (let pass = 0; pass < 8; pass += 1) {
    const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
    samples.forEach((sample, index) => {
      const cluster = rgbDistance(sample.rgb, centers[0]) <= rgbDistance(sample.rgb, centers[1]) ? 0 : 1;
      assignments[index] = cluster;
      sums[cluster][0] += sample.rgb[0]; sums[cluster][1] += sample.rgb[1]; sums[cluster][2] += sample.rgb[2]; sums[cluster][3] += 1;
    });
    if (!sums[0][3] || !sums[1][3]) return null;
    centers = sums.map(sum => [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]);
  }
  const counts = [0, 0], spread = [0, 0];
  samples.forEach((sample, index) => {
    const cluster = assignments[index];
    counts[cluster] += 1;
    spread[cluster] += Math.sqrt(rgbDistance(sample.rgb, centers[cluster]));
  });
  spread[0] /= counts[0]; spread[1] /= counts[1];
  const luminance = color => color[0] * .299 + color[1] * .587 + color[2] * .114;
  if (luminance(centers[0]) > luminance(centers[1])) {
    centers = [centers[1], centers[0]];
    counts.reverse(); spread.reverse();
    assignments = Uint8Array.from(assignments, value => value ? 0 : 1);
  }
  const separation = luminance(centers[1]) - luminance(centers[0]);
  const minorityRatio = Math.min(counts[0], counts[1]) / samples.length;
  const sampleMap = new Map(samples.map((sample, index) => [`${sample.x},${sample.y}`, index]));
  let edges = 0, comparisons = 0;
  samples.forEach((sample, index) => {
    [[step, 0], [0, step]].forEach(([dx, dy]) => {
      const near = sampleMap.get(`${sample.x + dx},${sample.y + dy}`);
      if (near == null) return;
      comparisons += 1;
      if (assignments[index] !== assignments[near]) edges += 1;
    });
  });
  const edgeRatio = comparisons ? edges / comparisons : 0;
  const averageSpread = (spread[0] * counts[0] + spread[1] * counts[1]) / samples.length;
  const isBinary = separation >= 92
    && minorityRatio >= .055
    && averageSpread <= 18
    && Math.max(...spread) <= 22
    && edgeRatio >= .025
    && edgeRatio <= .62;
  return { isBinary, centers, counts, spread, separation, minorityRatio, edgeRatio };
}

// 调用方不一定知道素材是照片、插画还是文字图形。文字、Logo 和横向字标若
// 套用照片的小图黑包边，会把字腔填实、直角削圆；因此在没有明确类型时，
// 用“稳定纯色背景 + 低色数 + 扁长前景”识别硬边图形。判定刻意保守：普通
// Q 版角色、宠物和人物即使颜色不多，也不会仅因色数少而被归为 graphic。
function inferSourceKind(data, width, height, options = {}) {
  if (options.sourceKind && options.sourceKind !== 'auto') return options.sourceKind;
  // “画面主要由深色和白色组成”不是二维码证据。白底卡通、线稿、深色
  // 制服和 Logo 都可能天然接近两簇颜色；一旦在这里返回 binary，后续会
  // 强制把肤色、服装高光和配饰压成两种材料。自动导入只允许上游已经通过
  // 三定位框、时序线和标准模块数验证的 QR 进入 binary；普通图片继续按
  // graphic / illustration 映射。调用方明确指定 binary 时仍保留该能力。
  const estimate = estimateBorderBackground(data, width, height, options);
  if (!estimate) return 'photo';
  const thresholdSquared = estimate.threshold * estimate.threshold;
  const bins = new Set();
  let foreground = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) continue;
    const pixel = [data[index], data[index + 1], data[index + 2]];
    if (rgbDistance(pixel, estimate.color) <= thresholdSquared) continue;
    foreground += 1;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    bins.add(`${Math.round(pixel[0] / 24)},${Math.round(pixel[1] / 24)},${Math.round(pixel[2] / 24)}`);
  }
  if (!foreground || maxX < minX || maxY < minY) return 'photo';
  const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
  const boxAspect = Math.max(boxWidth / Math.max(1, boxHeight), boxHeight / Math.max(1, boxWidth));
  const coverage = foreground / (width * height);
  const likelyGraphic = bins.size <= 18 && coverage <= .36 && boxAspect >= 1.75;
  return likelyGraphic ? 'graphic' : 'illustration';
}

function majorityCleanup(pattern, passes = 1, protectedMask) {
  let current = pattern;
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((row, y) => row.map((color, x) => {
      if (!color) return null;
      if (protectedMask && protectedMask[y * row.length + x]) return color;
      const counts = {}, values = {};
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const near = current[y + dy] && current[y + dy][x + dx];
        if (near) { counts[near[0]] = (counts[near[0]] || 0) + 1; values[near[0]] = near; }
      }
      let code = color[0], count = 0;
      Object.keys(counts).forEach(key => { if (counts[key] > count) { code = key; count = counts[key]; } });
      return count >= 6 ? values[code] : color;
    }));
  }
  return current;
}

function colorLuminance(color) {
  return color[2] * .299 + color[3] * .587 + color[4] * .114;
}

function sourceLuminance(data, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 255;
  const index = (y * width + x) * 4;
  if (data[index + 3] < 24) return 255;
  return data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
}

function hasLightNeutralSubject(data, width, height, background) {
  let solid = 0, lightNeutral = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const position = y * width + x, index = position * 4;
    if (data[index + 3] < 24 || (background && background[position])) continue;
    solid += 1;
    const r = data[index], g = data[index + 1], b = data[index + 2];
    const light = r * .299 + g * .587 + b * .114;
    if (light >= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 32) lightNeutral += 1;
  }
  return solid > 0 && lightNeutral / solid >= .46;
}

// 有些用户上传的是已经排好版的图纸或带成品黑框的插画。封闭外框会阻止
// 背景洪泛进入框内白底；若继续用“浅色主体自动描边”，框内深蓝制服、深色
// 头发等会被整片压成黑色。逐个检查若干可能的内缩位置，只有上下左右四边
// 都是高覆盖率暗线时才认定为成品外框，普通人物轮廓不可能同时满足四条边。
function hasEnclosingDarkFrame(data, width, height) {
  const minimum = Math.min(width, height);
  if (minimum < 20) return false;
  const maxInset = Math.min(6, Math.max(1, Math.floor(minimum * .12)));
  const isDark = (x, y) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) return false;
    return data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114 <= 92;
  };
  const ratio = values => values.filter(Boolean).length / Math.max(1, values.length);
  for (let inset = 0; inset <= maxInset; inset += 1) {
    const left = inset, right = width - inset - 1, top = inset, bottom = height - inset - 1;
    if (right - left < 12 || bottom - top < 12) continue;
    const horizontalStart = left + 1, horizontalEnd = right - 1;
    const verticalStart = top + 1, verticalEnd = bottom - 1;
    const topLine = [], bottomLine = [], leftLine = [], rightLine = [];
    for (let x = horizontalStart; x <= horizontalEnd; x += 1) {
      topLine.push(isDark(x, top)); bottomLine.push(isDark(x, bottom));
    }
    for (let y = verticalStart; y <= verticalEnd; y += 1) {
      leftLine.push(isDark(left, y)); rightLine.push(isDark(right, y));
    }
    const sideRatios = [ratio(topLine), ratio(bottomLine), ratio(leftLine), ratio(rightLine)];
    if (Math.min(...sideRatios) >= .72 && sideRatios.reduce((sum, value) => sum + value, 0) / 4 >= .82) return true;
  }
  return false;
}

function isOutlinePixel(data, width, height, x, y, strength = 0) {
  const center = sourceLuminance(data, width, height, x, y);
  // 最深的像素通常是眼睛、鼻子、嘴巴或真实轮廓，始终保留；小尺寸只降低
  // 局部对比门槛，不再把所有棕色、绿色等中间色强制压成大片黑色。
  if (center <= 86) return true;
  if (center > 150 + strength * 6) return false;
  let lightestNeighbor = center;
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    if (!dx && !dy) continue;
    lightestNeighbor = Math.max(lightestNeighbor, sourceLuminance(data, width, height, x + dx, y + dy));
  }
  return lightestNeighbor - center >= 56 - strength * 5;
}

function isEyeHighlightPixel(data, width, height, x, y) {
  const index = (y * width + x) * 4;
  const center = sourceLuminance(data, width, height, x, y);
  const channelRange = Math.max(data[index], data[index + 1], data[index + 2])
    - Math.min(data[index], data[index + 1], data[index + 2]);
  // 眼睛高光应当是接近纯白的低彩度亮点。旧阈值 190 会把浅粉皮肤、灰紫
  // 衣服反光和缩放后的背景边缘都强制升级成 H2，形成大白块和白色碎点。
  if (center < 238 || channelRange > 24) return false;
  const darkWithin = (dx, dy) => {
    for (let step = 1; step <= 2; step += 1) if (sourceLuminance(data, width, height, x + dx * step, y + dy * step) <= 112) return true;
    return false;
  };
  const left = darkWithin(-1, 0), right = darkWithin(1, 0), top = darkWithin(0, -1), bottom = darkWithin(0, 1);
  // 高光必须位于深色块内部：至少有一组相对方向被深色包住，并在另一轴也
  // 有深色支撑。这样顶部描边断口中的白背景不会再被误认成眼睛高光。
  return (left && right && (top || bottom)) || (top && bottom && (left || right));
}

// 眼睛、鼻子、嘴巴、眉毛等关键五官未必属于最外层描边，也未必是纯黑。
// 减少颜色模式如果只保护外轮廓，会把这些小而重要的深色结构并入皮肤、
// 头发或衣服。这里用“深色中心被较亮区域包围”的局部对比识别关键结构，
// 它不会把整片黑发或黑衣都标成五官，因为均匀暗色内部没有足够亮邻居。
function isKeyFeaturePixel(data, width, height, x, y, background) {
  const position = y * width + x;
  if (background && background[position]) return false;
  const center = sourceLuminance(data, width, height, x, y);
  if (center > 122) return false;
  let valid = 0, lighter = 0, strongestGap = 0;
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    if (!dx && !dy) continue;
    const nearX = x + dx, nearY = y + dy;
    if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) continue;
    const nearPosition = nearY * width + nearX;
    if (background && background[nearPosition]) continue;
    const gap = sourceLuminance(data, width, height, nearX, nearY) - center;
    valid += 1; strongestGap = Math.max(strongestGap, gap);
    if (gap >= 30) lighter += 1;
  }
  if (valid < 3) return false;
  return (center <= 84 && lighter >= 1 && strongestGap >= 42)
    || (center <= 112 && lighter >= 3 && strongestGap >= 52);
}

// 浅色前景内部同样需要结构线。纸卡边框、白衣褶皱、鼻梁和浅色饰品的线条
// 往往不是黑色，直接缩小后又只有十几个亮度差；旧逻辑只保护深色描边，最终
// 这些浅灰/米灰线会和白色填充合并。这里只识别“局部亮度谷”，保留原色系，
// 不把它强制改黑，也不会在已经确认的外部背景上制造线条。
function isSoftStructurePixel(data, width, height, x, y, background) {
  const position = y * width + x;
  if (background && background[position]) return false;
  const center = sourceLuminance(data, width, height, x, y);
  if (center < 128 || center > 244) return false;
  const light = (dx, dy) => {
    const nearX = x + dx, nearY = y + dy;
    if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) return null;
    const nearPosition = nearY * width + nearX;
    if (background && background[nearPosition]) return null;
    return sourceLuminance(data, width, height, nearX, nearY);
  };
  const left = light(-1, 0), right = light(1, 0), top = light(0, -1), bottom = light(0, 1);
  const above = value => value !== null && value - center >= 12;
  const strongAbove = value => value !== null && value - center >= 20;
  const horizontalValley = above(left) && above(right) && (strongAbove(left) || strongAbove(right));
  const verticalValley = above(top) && above(bottom) && (strongAbove(top) || strongAbove(bottom));
  const values = [left, right, top, bottom].filter(value => value !== null);
  const lighter = values.filter(value => value - center >= 14).length;
  return horizontalValley || verticalValley || (lighter >= 3 && Math.max(...values) - center >= 22);
}

function repairOutlineGaps(pattern, outlineColor, maxDistance = 1) {
  const isDark = color => color && colorLuminance(color) <= 125;
  const darkWithin = (x, y, dx, dy) => {
    for (let step = 1; step <= maxDistance; step += 1) {
      const row = pattern[y + dy * step], color = row && row[x + dx * step];
      if (color) return isDark(color);
    }
    return false;
  };
  return pattern.map((row, y) => row.map((color, x) => {
    if (color) return color;
    const adjacent = [[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy]) => pattern[y + dy] && pattern[y + dy][x + dx]);
    if (!adjacent) return null;
    const horizontal = darkWithin(x, y, -1, 0) && darkWithin(x, y, 1, 0);
    const vertical = darkWithin(x, y, 0, -1) && darkWithin(x, y, 0, 1);
    const diagonalA = darkWithin(x, y, -1, -1) && darkWithin(x, y, 1, 1);
    const diagonalB = darkWithin(x, y, 1, -1) && darkWithin(x, y, -1, 1);
    return horizontal || vertical || diagonalA || diagonalB ? outlineColor : null;
  }));
}

function smoothHoles(pattern) {
  return pattern.map((row, y) => row.map((color, x) => {
    const neighbors = [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy]) => pattern[y + dy] && pattern[y + dy][x + dx]).filter(Boolean);
    if (!color && neighbors.length >= 3) {
      const counts = {};
      neighbors.forEach(item => { counts[item[0]] = (counts[item[0]] || 0) + 1; });
      const code = Object.keys(counts).sort((a,b) => counts[b] - counts[a])[0];
      if (counts[code] >= 3) return neighbors.find(item => item[0] === code);
    }
    return color;
  }));
}

function restoreInteriorGaps(pattern, data, width, height, palette, prepared, options = {}, background) {
  // “封闭”不等于“应该填满”。字母 O、眼睛、手臂与身体之间的留白和蝴蝶
  // 翅膀间隙都是有意义的负空间。这里只修复由低分辨率采样造成的 1–2 格
  // 微小缺口，并且必须有原始前景证据；不再把所有封闭空洞一律回填。
  const visited = new Uint8Array(width * height), fill = new Uint8Array(width * height);
  const maxArea = Number(options.maxInteriorGapArea || (Math.max(width, height) <= 52 ? 2 : 3));
  const offsets = [[0,-1],[1,0],[0,1],[-1,0]];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const start = y * width + x;
    if (pattern[y][x] || visited[start]) continue;
    visited[start] = 1;
    const queue = [start];
    let touchesEdge = false, hasSourceEvidence = true;
    for (let head = 0; head < queue.length; head += 1) {
      const position = queue[head], currentX = position % width, currentY = Math.floor(position / width);
      if (!currentX || !currentY || currentX === width - 1 || currentY === height - 1) touchesEdge = true;
      const index = position * 4;
      if (data[index + 3] < 24 || (background && background[position])) hasSourceEvidence = false;
      offsets.forEach(([dx, dy]) => {
        const nearX = currentX + dx, nearY = currentY + dy;
        if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) return;
        const near = nearY * width + nearX;
        if (pattern[nearY][nearX] || visited[near]) return;
        visited[near] = 1; queue.push(near);
      });
    }
    if (!touchesEdge && hasSourceEvidence && queue.length <= maxArea) queue.forEach(position => { fill[position] = 1; });
  }

  return pattern.map((row, y) => row.map((color, x) => {
    const position = y * width + x;
    if (color || !fill[position]) return color;
    const neighbors = [];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const near = pattern[y + dy] && pattern[y + dy][x + dx];
      if (near) neighbors.push(near);
    }
    if (neighbors.length) {
      const counts = {};
      neighbors.forEach(item => { counts[item[0]] = (counts[item[0]] || 0) + 1; });
      const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (counts[dominant] >= 2) return neighbors.find(item => item[0] === dominant);
    }
    const index = position * 4;
    return nearest([data[index], data[index + 1], data[index + 2]], palette, prepared);
  }));
}

function keepMainPhysicalPiece(pattern) {
  const height = pattern.length, width = pattern[0] ? pattern[0].length : 0;
  if (!width || !height) return pattern;

  // 斜向相邻的两颗豆在图像上是连续线条，但热熔后仅对角接触并不牢固。
  // 先在两个可选的直角格中补上“对主体支撑更多”的一格，就能同时保留
  // 手指、腿、尾巴和天线，并使最终图纸真正可以整件拿起。
  let connected = pattern.map(row => row.slice());
  const colorAt = (x, y) => connected[y] && connected[y][x];
  const support = (x, y) => {
    let count = 0;
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) if (colorAt(x + dx, y + dy)) count += 1;
    return count;
  };
  for (let y = 0; y < height - 1; y += 1) for (let x = 0; x < width - 1; x += 1) {
    const topLeft = colorAt(x, y), topRight = colorAt(x + 1, y), bottomLeft = colorAt(x, y + 1), bottomRight = colorAt(x + 1, y + 1);
    let first = null, second = null, paint = null;
    if (topLeft && bottomRight && !topRight && !bottomLeft) {
      first = [x + 1, y]; second = [x, y + 1]; paint = colorLuminance(topLeft) <= colorLuminance(bottomRight) ? topLeft : bottomRight;
    } else if (topRight && bottomLeft && !topLeft && !bottomRight) {
      first = [x, y]; second = [x + 1, y + 1]; paint = colorLuminance(topRight) <= colorLuminance(bottomLeft) ? topRight : bottomLeft;
    }
    if (!first) continue;
    const target = support(first[0], first[1]) >= support(second[0], second[1]) ? first : second;
    connected[target[1]][target[0]] = paint;
  }

  const labels = new Int32Array(width * height), sizes = [0];
  let label = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const start = y * width + x;
    if (!connected[y][x] || labels[start]) continue;
    label += 1; sizes[label] = 0; labels[start] = label;
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const position = queue[head], currentX = position % width, currentY = Math.floor(position / width);
      sizes[label] += 1;
      [[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx,dy]) => {
        const nearX = currentX + dx, nearY = currentY + dy;
        if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) return;
        const near = nearY * width + nearX;
        if (!connected[nearY][nearX] || labels[near]) return;
        labels[near] = label; queue.push(near);
      });
    }
  }
  if (label <= 1) return connected;
  let main = 1;
  for (let current = 2; current <= label; current += 1) if (sizes[current] > sizes[main]) main = current;
  return connected.map((row, y) => row.map((color, x) => labels[y * width + x] === main ? color : null));
}

function softenBlockyCorners(pattern, passes = 1) {
  let current = pattern;
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((row, y) => row.map((color, x) => {
      if (!color) return null;
      const solid = (dx, dy) => Boolean(current[y + dy] && current[y + dy][x + dx]);
      // 只削去带完整 2×2 内支撑的直角尖端，不碰单格耳尖、发梢等细节，
      // 让方形拐角变成自然的阶梯圆角，同时保持主体连接。
      const topLeft = !solid(0, -1) && !solid(-1, 0) && solid(1, 0) && solid(0, 1) && solid(1, 1);
      const topRight = !solid(0, -1) && !solid(1, 0) && solid(-1, 0) && solid(0, 1) && solid(-1, 1);
      const bottomLeft = !solid(0, 1) && !solid(-1, 0) && solid(1, 0) && solid(0, -1) && solid(1, -1);
      const bottomRight = !solid(0, 1) && !solid(1, 0) && solid(-1, 0) && solid(0, -1) && solid(-1, -1);
      return topLeft || topRight || bottomLeft || bottomRight ? null : color;
    }));
  }
  return current;
}

// 吸收黑色外框上多出来的一格小凸角/毛刺。典型情况是某一格只靠一条边
// 接在主体上，而它后方横向或纵向已有连续三格主体支撑；删掉这一格只会让
// 轮廓回到原来的平滑边线，不会打开主体内部。普通斜边、两格以上的耳尖、
// 发梢和手脚不会满足“三格平直支撑”，因此仍然保留。
function absorbBoundaryBumps(pattern, outlineColor, passes = 1) {
  let current = pattern;
  const sameOutline = color => color && color[0] === outlineColor[0];
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((row, y) => row.map((color, x) => {
      if (!sameOutline(color)) return color;
      const solid = (dx, dy) => Boolean(current[y + dy] && current[y + dy][x + dx]);
      const cardinal = [[0,-1],[1,0],[0,1],[-1,0]].filter(([dx, dy]) => solid(dx, dy));
      if (cardinal.length !== 1) return color;
      const [supportX, supportY] = cardinal[0];
      if (supportX === 0) {
        const supported = solid(-1, supportY) && solid(0, supportY) && solid(1, supportY);
        return supported ? null : color;
      }
      const supported = solid(supportX, -1) && solid(supportX, 0) && solid(supportX, 1);
      return supported ? null : color;
    }));
  }
  return current;
}

function blackenExteriorBoundary(pattern, outlineColor, preserveThinColor = true) {
  const height = pattern.length, width = pattern[0] ? pattern[0].length : 0;
  if (!width || !height || !outlineColor) return pattern;
  const exterior = new Uint8Array(width * height), queue = [];
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const position = y * width + x;
    if (exterior[position] || pattern[y][x]) return;
    exterior[position] = 1; queue.push(position);
  };
  for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
  for (let head = 0; head < queue.length; head += 1) {
    const position = queue[head], x = position % width, y = Math.floor(position / width);
    // 包边专用的外部背景按八方向连通，斜边旁只在对角相接的背景也能被
    // 正确识别；主体抠背景仍保持更谨慎的四方向洪泛。
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (dx || dy) enqueue(x + dx, y + dy);
    }
  }
  if (!queue.length) return pattern;
  return pattern.map((row, y) => row.map((color, x) => {
    if (!color) return null;
    // 只检查上下左右的直接外部背景。旧实现还检查四个对角，容易让斜边和
    // 圆角额外变粗，最终看起来像套了一个方正黑框。
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const nearX = x + dx, nearY = y + dy;
      if (nearX >= 0 && nearY >= 0 && nearX < width && nearY < height && exterior[nearY * width + nearX]) {
        if (preserveThinColor && color[0] !== outlineColor[0]) {
          const solid = (offsetX, offsetY) => Boolean(pattern[y + offsetY] && pattern[y + offsetY][x + offsetX]);
          const verticalStroke = solid(0, -1) && solid(0, 1) && !solid(-1, 0) && !solid(1, 0);
          const horizontalStroke = solid(-1, 0) && solid(1, 0) && !solid(0, -1) && !solid(0, 1);
          let surrounding = 0;
          for (let aroundY = -1; aroundY <= 1; aroundY += 1) for (let aroundX = -1; aroundX <= 1; aroundX += 1) {
            if ((aroundX || aroundY) && solid(aroundX, aroundY)) surrounding += 1;
          }
          // 一格宽的彩色天线、丝带和文字笔画自身就是结构，不应被包边逻辑
          // 整条改黑。主体平面边缘通常有 3 个以上邻格，不会命中这条保护。
          const thinEndpoint = surrounding <= 2;
          if (verticalStroke || horizontalStroke || thinEndpoint) return color;
        }
        return outlineColor;
      }
    }
    return color;
  }));
}

// 先建立一份稳定的“丰富颜色”基础图，再在同一份结果上生成“减少颜色”。
// 减少模式只能复用基础图已经出现过的色号，因此颜色数量在数学上不可能反超
// 丰富模式；同时按连续大色块和全图同色两层归一，接近人工整理拼豆图纸。
function mapColorRegions(data, width, height, palette, prepared, options, background, adaptiveOutline, outlineColor, highlightColor) {
  const count = width * height, pixels = new Array(count), labs = new Array(count), types = new Uint8Array(count), protectedMask = new Uint8Array(count);
  const detailed = Array.from({ length: height }, () => Array(width).fill(null));
  // 普通前景禁止使用与画布背景完全相同的极白色号。纯白只留给单独识别出的
  // 眼睛高光；白衣、纸张和浅色饰品改用米白/浅灰/冷白，才能在白底上保留层次。
  // 始终允许完整色卡参与匹配。非纯白前景误落 H2 的风险已经在感知距离中
  // 单独加罚；而真正的白衣、白毛和图形主体必须仍可使用实体纯白拼豆。
  const foregroundPrepared = prepared;
  const foregroundPalette = palette;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const position = y * width + x, index = position * 4;
    // 背景遮罩是“从画布边缘连通的区域”，一旦确认为背景就必须直接跳过。
    // 旧逻辑还会在这些格子上重新检测“描边/眼睛高光”，导致白底被整片放回图纸。
    if (data[index + 3] < 24 || (background && background[position])) continue;
    const outline = adaptiveOutline && isOutlinePixel(data, width, height, x, y, options.outlineStrength || 0);
    const eyeHighlight = options.preserveEyeHighlights !== false && isEyeHighlightPixel(data, width, height, x, y);
    const keyFeature = options.preserveKeyFeatures !== false && isKeyFeaturePixel(data, width, height, x, y, background);
    let paint = null;
    if (eyeHighlight) {
      pixels[position] = [highlightColor[2], highlightColor[3], highlightColor[4]];
      labs[position] = rgbToLab(pixels[position]); types[position] = 2; protectedMask[position] = 1;
      paint = highlightColor;
    } else if (outline) {
      pixels[position] = [outlineColor[2], outlineColor[3], outlineColor[4]];
      labs[position] = rgbToLab(pixels[position]); types[position] = 1; protectedMask[position] = 1;
      paint = outlineColor;
    } else if (keyFeature) {
      pixels[position] = adjustPixel([data[index], data[index + 1], data[index + 2]], options);
      labs[position] = rgbToLab(pixels[position]); types[position] = 3; protectedMask[position] = 1;
      // 近黑的局部结构统一用真正的黑色；有明确色相的深蓝眼睛、棕色眉毛等
      // 仍从完整色卡匹配，不会一律染黑。
      const featureChroma = Math.hypot(labs[position][1], labs[position][2]);
      paint = labs[position][0] <= 28 && featureChroma <= 20
        ? outlineColor
        : nearest(pixels[position], foregroundPalette, foregroundPrepared);
    } else {
      pixels[position] = adjustPixel([data[index], data[index + 1], data[index + 2]], options);
      labs[position] = rgbToLab(pixels[position]);
      // 丰富模式保留浅灰卡片线、衣褶等微结构；减少模式把这些抗锯齿层交给
      // 大色块归一，避免每条浅线各自增加一个只用一两颗的材料色号。
      // 浅灰衣褶、卡片边线等需要保留“位置”，但不需要为每一档抗锯齿各留
      // 一个材料色号。它们继续参与普通大色块归一，只在后续去杂色时受保护。
      if (isSoftStructurePixel(data, width, height, x, y, background)) protectedMask[position] = 1;
      paint = nearest(pixels[position], foregroundPalette, foregroundPrepared);
      const chroma = Math.hypot(labs[position][1], labs[position][2]);
      if (labs[position][0] <= 23 && chroma <= 19) paint = outlineColor;
      else if (chroma <= 22 && (paint[0] === 'H16' || paint[0] === 'M12')) {
        const neutral = clamp(Math.round(pixels[position][0] * .299 + pixels[position][1] * .587 + pixels[position][2] * .114), 0, 255);
        paint = nearest([neutral, neutral, neutral], foregroundPalette, foregroundPrepared);
      }
    }
    detailed[y][x] = paint;
  }

  const compact = options.regionMode !== 'rich';
  const longSide = Math.max(width, height);
  const minimumArea = Number(options.minimumRegionArea || (longSide <= 36 ? 2 : (longSide <= 60 ? 3 : (longSide <= 84 ? 4 : 5))));
  const labels = new Int32Array(count); labels.fill(-1);
  const regions = [];
  const offsets = [[0,-1],[1,0],[0,1],[-1,0]];

  for (let start = 0; start < count; start += 1) {
    if (!pixels[start] || labels[start] >= 0) continue;
    const id = regions.length, type = types[start], members = [], queue = [start], codeCounts = new Map(), codeColors = new Map();
    let sumL = 0, sumA = 0, sumLabB = 0;
    labels[start] = id;
    for (let head = 0; head < queue.length; head += 1) {
      const position = queue[head], x = position % width, y = Math.floor(position / width), lab = labs[position], color = detailed[y][x];
      members.push(position); sumL += lab[0]; sumA += lab[1]; sumLabB += lab[2];
      codeCounts.set(color[0], (codeCounts.get(color[0]) || 0) + 1); codeColors.set(color[0], color);
      const regionSize = members.length, meanLab = [sumL / regionSize, sumA / regionSize, sumLabB / regionSize];
      offsets.forEach(([dx, dy]) => {
        const nearX = x + dx, nearY = y + dy;
        if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) return;
        const near = nearY * width + nearX;
        if (!pixels[near] || labels[near] >= 0 || types[near] !== type) return;
        if (type > 0) {
          if (detailed[nearY][nearX][0] !== color[0]) return;
        } else if ((compact || protectedMask[near] === protectedMask[position])
          && (!sameLargeBlockColor(lab, labs[near], longSide) || !sameLargeBlockColor(meanLab, labs[near], longSide))) return;
        else if (!compact && protectedMask[near] !== protectedMask[position]) return;
        labels[near] = id; queue.push(near);
      });
    }
    const size = members.length, averageLab = [sumL / size, sumA / size, sumLabB / size];
    const dominant = Array.from(codeCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    regions.push({ id, type, members, size, lab: averageLab, neighbors: new Map(), paint: codeColors.get(dominant) });
  }

  // 统计色块接壤长度。只有微小区域才允许并入邻居，大块的白色脸、灰色头部
  // 即使颜色接近也仍是两个区域，不会被错误合并。
  regions.forEach(region => region.members.forEach(position => {
    const x = position % width, y = Math.floor(position / width);
    offsets.forEach(([dx, dy]) => {
      const nearX = x + dx, nearY = y + dy;
      if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) return;
      const nearLabel = labels[nearY * width + nearX];
      if (nearLabel >= 0 && nearLabel !== region.id) region.neighbors.set(nearLabel, (region.neighbors.get(nearLabel) || 0) + 1);
    });
  }));

  if (!compact) {
    // 丰富颜色不是“每格任意找一个最近色”。连续的皮肤、头发、制服和阴影
    // 先按感知色差组成区域，再统一使用该区域出现次数最多的真实色号。这样
    // 仍保留彼此分开的高光、阴影、五官和点缀，却不会把 JPG、缩放或柔和
    // 渐变拆成一两颗一个色号的噪点。保护结构单独成区，不会被大色面吞掉。
    const richPattern = Array.from({ length: height }, () => Array(width).fill(null));
    regions.forEach(region => region.members.forEach(position => {
      richPattern[Math.floor(position / width)][position % width] = region.paint;
    }));
    return { pattern: richPattern, protectedMask };
  }

  // 跨区域复用：左右耳朵、两只眼睛、分开的衣袖等即使不相连，只要属于同一
  // 视觉颜色家族，也统一使用面积最大色块的主色号。代表色始终取自丰富图，
  // 不会在减少模式中凭空生成一个丰富模式没有的新色号。
  const canonical = [];
  regions.filter(region => region.type === 0)
    .sort((a, b) => b.size - a.size)
    .forEach(region => {
      const family = canonical.find(item => reusableColorFamily(region.lab, item.anchorLab, longSide));
      if (family) family.regions.push(region);
      else canonical.push({ anchorLab: region.lab, regions: [region] });
    });

  // 每个颜色家族不再机械采用“面积最大区域的第一个色号”。先计算整组区域的
  // 加权平均，再把目标轻量提亮、提彩，并从丰富模式已经真实出现过的色号中
  // 选最接近者。这样橙、粉、黄、绿、青、蓝、紫都会变成更明快的大色块，
  // 同时仍保持减少模式是丰富模式色号的子集，不会凭空发明新颜色。
  canonical.forEach(family => {
    const total = family.regions.reduce((sum, region) => sum + region.size, 0) || 1;
    const average = [0, 1, 2].map(channel => family.regions.reduce((sum, region) => sum + region.lab[channel] * region.size, 0) / total);
    const chroma = Math.hypot(average[1], average[2]);
    const target = average.slice();
    // 中暗到中亮的普通填色向浅色调移动一档；极暗结构、黑色包边和本来就
    // 很浅的白色不动。彩色目标提高约 24% 彩度，让减少颜色后的单一主色
    // 仍然明艳，而不是面积一大就退化成灰棕色。
    if (target[0] >= 28 && target[0] < 82) target[0] += clamp((78 - target[0]) * .34, 0, 11);
    if (chroma >= 12) { target[1] *= 1.24; target[2] *= 1.24; }
    const candidates = [];
    const seen = new Set();
    family.regions.forEach(region => {
      if (seen.has(region.paint[0])) return;
      seen.add(region.paint[0]);
      candidates.push({ paint: region.paint, lab: rgbToLab([region.paint[2], region.paint[3], region.paint[4]]), size: region.size });
    });
    const selected = candidates.sort((a, b) => {
      const scoreA = labDistance(target, a.lab) - Math.log1p(a.size) * 14;
      const scoreB = labDistance(target, b.lab) - Math.log1p(b.size) * 14;
      return scoreA - scoreB;
    })[0];
    family.regions.forEach(region => { region.paint = selected.paint; });
  });

  for (let pass = 0; pass < 2; pass += 1) regions.forEach(region => {
    if (region.type || region.size > minimumArea || region.lab[0] <= 24 || !region.neighbors.size) return;
    const candidates = Array.from(region.neighbors.entries()).map(([id, border]) => ({ target: regions[id], border })).filter(item => item.target && item.target.type === 0)
      .sort((a, b) => b.border - a.border || b.target.size - a.target.size);
    if (!candidates.length) return;
    const compatible = candidates.find(item => reusableColorFamily(region.lab, item.target.lab, longSide));
    if (compatible) { region.paint = compatible.target.paint; return; }
    // 不再仅凭“面积小、边界长”把一个不同色相的小块吞进邻居。眼睛颜色、
    // 嘴角、腮红、黄色点缀等恰好经常只有一两颗；抗锯齿近似色已由上面的
    // compatible 分支合并，剩下的不兼容小块应作为真实结构保留。
  });

  const pattern = Array.from({ length: height }, () => Array(width).fill(null));
  regions.forEach(region => region.members.forEach(position => { pattern[Math.floor(position / width)][position % width] = region.paint; }));
  return { pattern, protectedMask };
}

function finalizeMappedPattern(mapped, data, width, height, palette, prepared, options, background, adaptiveOutline, outlineColor) {
  const pattern = mapped.pattern, protectedOutline = mapped.protectedMask;
  let output = background && adaptiveOutline ? repairOutlineGaps(pattern, outlineColor, 1) : pattern;
  output = options.restoreInterior === false ? output : restoreInteriorGaps(output, data, width, height, palette, prepared, options, background);
  if (options.physicalIntegrity && options.sourceKind !== 'graphic') output = keepMainPhysicalPiece(output);
  if (options.removeNoise) output = majorityCleanup(output, options.denoise === 'high' ? 2 : 1, protectedOutline);
  if (options.smoothEdges) output = smoothHoles(output);
  if (options.blackBoundary && options.sourceKind !== 'graphic') {
    output = softenBlockyCorners(output, options.boundaryRounding || 1);
    output = blackenExteriorBoundary(output, outlineColor, true);
    output = absorbBoundaryBumps(output, outlineColor, options.boundaryBumpPasses || 1);
    output = blackenExteriorBoundary(output, outlineColor, true);
    if (options.ensureClosedBoundary) {
      output = repairOutlineGaps(output, outlineColor, 1);
      output = blackenExteriorBoundary(output, outlineColor, true);
      output = absorbBoundaryBumps(output, outlineColor, options.boundaryBumpPasses || 1);
      output = blackenExteriorBoundary(output, outlineColor, true);
    }
  }
  // 黑色/暖黑校正在丰富基础图生成时已经完成，两种模式共用同一份基础色号。
  // 这里不能再单独重匹配，否则减少模式可能引入丰富模式中不存在的新颜色。
  return output;
}

function chooseBinaryPalette(profile, palette, options = {}) {
  const sourceColors = profile.centers.map(color => adjustPixel(color, options));
  const sourceIsNeutral = sourceColors.every(color => Math.max(...color) - Math.min(...color) <= 20);
  if (sourceIsNeutral) {
    const sorted = palette.slice().sort((a, b) => {
      const lightA = a[2] * .299 + a[3] * .587 + a[4] * .114;
      const lightB = b[2] * .299 + b[3] * .587 + b[4] * .114;
      return lightA - lightB;
    });
    return [sorted[0], sorted[sorted.length - 1]];
  }
  const sourceLabs = sourceColors.map(rgbToLab);
  const paletteLabs = palette.map(color => rgbToLab([color[2], color[3], color[4]]));
  const luminance = color => color[2] * .299 + color[3] * .587 + color[4] * .114;
  let best = null;
  for (let darkIndex = 0; darkIndex < palette.length; darkIndex += 1) {
    for (let lightIndex = 0; lightIndex < palette.length; lightIndex += 1) {
      if (darkIndex === lightIndex) continue;
      const contrast = luminance(palette[lightIndex]) - luminance(palette[darkIndex]);
      if (contrast <= 0) continue;
      let score = perceptualDistance(sourceLabs[0], paletteLabs[darkIndex])
        + perceptualDistance(sourceLabs[1], paletteLabs[lightIndex]);
      // 功能图形优先保证实物深浅对比；当色卡套餐没有理想组合时仍允许选出
      // 最佳可用对，而不是直接失败。110 与二维码页面现有校验保持一致。
      if (contrast < 110) {
        const gap = 110 - contrast;
        score += gap * gap * 7;
      }
      if (!best || score < best.score) best = { score, colors: [palette[darkIndex], palette[lightIndex]] };
    }
  }
  return best ? best.colors : [nearest(sourceColors[0], palette), nearest(sourceColors[1], palette)];
}

function mapBinaryPixels(data, width, height, palette, options = {}) {
  const profile = analyzeTwoColorStructure(data, width, height);
  if (!profile || !profile.centers) return null;
  const colors = chooseBinaryPalette(profile, palette, options);
  const output = Array.from({ length: height }, () => Array(width).fill(null));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) continue;
    const pixel = [data[index], data[index + 1], data[index + 2]];
    output[y][x] = rgbDistance(pixel, profile.centers[0]) <= rgbDistance(pixel, profile.centers[1]) ? colors[0] : colors[1];
  }
  return output;
}

function patternColorCounts(pattern) {
  const counts = new Map(), colors = new Map();
  pattern.forEach(row => row.forEach(color => {
    if (!color) return;
    counts.set(color[0], (counts.get(color[0]) || 0) + 1);
    colors.set(color[0], color);
  }));
  return { counts, colors };
}

function recommendedCompactColorLimit(options, width, height) {
  const explicit = Number(options.maximumColors || 0);
  if (explicit > 1) return clamp(Math.round(explicit), 2, 48);
  const longSide = Math.max(width, height);
  if (options.sourceKind === 'graphic') return longSide <= 60 ? 8 : (longSide <= 84 ? 12 : 16);
  if (options.sourceKind === 'photo') return longSide <= 36 ? 12 : (longSide <= 60 ? 16 : (longSide <= 84 ? 20 : 24));
  return longSide <= 60 ? 12 : (longSide <= 84 ? 16 : 20);
}

function recommendedRichColorLimit(options, width, height) {
  const explicit = Number(options.richMaximumColors || 0);
  if (explicit > 1) return clamp(Math.round(explicit), 2, 64);
  const longSide = Math.max(width, height);
  if (options.sourceKind === 'graphic') return longSide <= 36 ? 12 : (longSide <= 60 ? 16 : (longSide <= 84 ? 22 : 28));
  if (options.sourceKind === 'photo') return longSide <= 36 ? 18 : (longSide <= 60 ? 24 : (longSide <= 84 ? 32 : 40));
  return longSide <= 36 ? 16 : (longSide <= 60 ? 20 : (longSide <= 84 ? 28 : 36));
}

// compact 的局部色块逻辑擅长判断“这张图大约需要多少种颜色”，但它的代表
// 色只能从各局部区域中逐一选出，容易出现颜色很多却整体偏色。这里保留它算出
// 的色数作为上限，再从最终 rich 图真实使用过的色号中做一次全局选择：大面积
// 主色按整图共同竞争，小面积保护结构提高权重，最后所有格子只映射到这组颜色。
function consolidateGlobalPalette(richPattern, compactPattern, data, width, height, options, protectedMask, outlineColor, highlightColor) {
  const rich = patternColorCounts(richPattern), compact = patternColorCounts(compactPattern);
  const limit = Math.min(compact.colors.size, recommendedCompactColorLimit(options, width, height));
  const candidates = Array.from(rich.colors.values());
  if (limit < 2 || candidates.length <= limit) return compactPattern;

  const candidateIndex = new Map(candidates.map((color, index) => [color[0], index]));
  const candidateLabs = candidates.map(color => rgbToLab([color[2], color[3], color[4]]));
  const histogramMap = new Map();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!compactPattern[y][x]) continue;
    const position = y * width + x, index = position * 4;
    const pixel = data[index + 3] >= 24
      ? adjustPixel([data[index], data[index + 1], data[index + 2]], options)
      : [compactPattern[y][x][2], compactPattern[y][x][3], compactPattern[y][x][4]];
    const key = `${Math.round(pixel[0] / 16)},${Math.round(pixel[1] / 16)},${Math.round(pixel[2] / 16)}`;
    const item = histogramMap.get(key) || { lab: rgbToLab(pixel), weight: 0 };
    item.weight += protectedMask && protectedMask[position] ? 4 : 1;
    histogramMap.set(key, item);
  }
  const histogram = Array.from(histogramMap.values());
  if (!histogram.length) return compactPattern;

  const forcedCodes = [];
  const force = code => {
    if (candidateIndex.has(code) && !forcedCodes.includes(code) && forcedCodes.length < limit) forcedCodes.push(code);
  };
  force(outlineColor[0]);
  force(highlightColor[0]);

  // 不同主色系至少保留一个在 compact 中已经确认过的代表色。这样全局面积
  // 优化不会为了大块肤色/白色，吞掉黄色发饰、蓝眼睛或绿色小道具。
  const familyRepresentatives = new Map();
  compact.colors.forEach((color, code) => {
    const lab = rgbToLab([color[2], color[3], color[4]]);
    const chroma = Math.hypot(lab[1], lab[2]), count = compact.counts.get(code) || 0;
    if (chroma < 18 || count < 2 || !candidateIndex.has(code)) return;
    const family = hueFamily(labHue(lab)), current = familyRepresentatives.get(family);
    if (!current || count > current.count) familyRepresentatives.set(family, { code, count });
  });
  Array.from(familyRepresentatives.values()).sort((a, b) => b.count - a.count).forEach(item => force(item.code));

  const selected = forcedCodes.map(code => candidateIndex.get(code));
  const selectedSet = new Set(selected);
  let bestDistances = histogram.map(item => {
    let best = Infinity;
    selected.forEach(index => { best = Math.min(best, perceptualDistance(item.lab, candidateLabs[index])); });
    return best;
  });
  while (selected.length < limit && selected.length < candidates.length) {
    let bestIndex = -1, bestScore = Infinity, bestNext = null;
    for (let candidate = 0; candidate < candidates.length; candidate += 1) {
      if (selectedSet.has(candidate)) continue;
      let score = 0;
      const next = new Array(histogram.length);
      for (let item = 0; item < histogram.length; item += 1) {
        const distance = Math.min(bestDistances[item], perceptualDistance(histogram[item].lab, candidateLabs[candidate]));
        next[item] = distance; score += distance * histogram[item].weight;
      }
      if (score < bestScore) { bestScore = score; bestIndex = candidate; bestNext = next; }
    }
    if (bestIndex < 0) break;
    selected.push(bestIndex); selectedSet.add(bestIndex); bestDistances = bestNext;
  }

  const selectedPalette = selected.map(index => candidates[index]);
  const selectedCodes = new Set(selectedPalette.map(color => color[0]));
  const targetsByCode = new Map();
  compactPattern.forEach((row, y) => row.forEach((color, x) => {
    if (!color) return;
    const position = y * width + x, index = position * 4;
    const pixel = data[index + 3] >= 24
      ? adjustPixel([data[index], data[index + 1], data[index + 2]], options)
      : [color[2], color[3], color[4]];
    const lab = rgbToLab(pixel), target = targetsByCode.get(color[0]) || { sum: [0, 0, 0], weight: 0 };
    const weight = protectedMask && protectedMask[position] ? 3 : 1;
    target.sum[0] += lab[0] * weight; target.sum[1] += lab[1] * weight; target.sum[2] += lab[2] * weight; target.weight += weight;
    targetsByCode.set(color[0], target);
  }));
  const assignments = new Map();
  compact.colors.forEach((color, code) => {
    if ((code === outlineColor[0] || code === highlightColor[0]) && selectedCodes.has(code)) {
      assignments.set(code, color); return;
    }
    const target = targetsByCode.get(code);
    const lab = target && target.weight
      ? target.sum.map(value => value / target.weight)
      : rgbToLab([color[2], color[3], color[4]]);
    let best = selectedPalette[0], bestScore = Infinity;
    selectedPalette.forEach((candidate, index) => {
      const score = perceptualDistance(lab, candidateLabs[selected[index]]);
      if (score < bestScore) { bestScore = score; best = candidate; }
    });
    assignments.set(code, best);
  });
  return compactPattern.map(row => row.map(color => color ? assignments.get(color[0]) : null));
}

function stabilizeRichPalette(pattern, data, width, height, options, protectedMask, outlineColor, highlightColor) {
  return consolidateGlobalPalette(
    pattern,
    pattern,
    data,
    width,
    height,
    { ...options, maximumColors: recommendedRichColorLimit(options, width, height) },
    protectedMask,
    outlineColor,
    highlightColor
  );
}

// H2 是否真的是源图中的纯白，必须在最终限色后逐格复核。全局色号归一是
// 按 code 处理的：背景里大量真白一旦确保 H2 入选，人物内部被误分到同一
// code 的浅灰、浅粉也会一起保留。这里用原始像素重新判断，伪白改到最终图
// 已有的最近非白色；随后清理没有被严格眼睛高光保护的一两颗孤立白点。
function cleanFalseWhiteArtifacts(pattern, data, width, height, options, protectedMask, highlightColor) {
  const used = new Map();
  pattern.forEach(row => row.forEach(color => {
    if (color && color[0] !== highlightColor[0]) used.set(color[0], color);
  }));
  const nonWhitePalette = Array.from(used.values());
  const nonWhitePrepared = nonWhitePalette.length ? preparePalette(nonWhitePalette) : [];
  let output = pattern.map((row, y) => row.map((color, x) => {
    if (!color || color[0] !== highlightColor[0] || !nonWhitePalette.length) return color;
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) return color;
    const adjusted = adjustPixel([data[index], data[index + 1], data[index + 2]], options);
    const light = adjusted[0] * .299 + adjusted[1] * .587 + adjusted[2] * .114;
    const range = Math.max(...adjusted) - Math.min(...adjusted);
    return light >= 238 && range <= 24 ? color : nearest(adjusted, nonWhitePalette, nonWhitePrepared);
  }));

  const visited = new Uint8Array(width * height), offsets = [[0,-1],[1,0],[0,1],[-1,0]];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const start = y * width + x;
    if (visited[start] || !output[y][x] || output[y][x][0] !== highlightColor[0]) continue;
    visited[start] = 1;
    const queue = [start];
    let protectedWhite = false;
    for (let head = 0; head < queue.length; head += 1) {
      const position = queue[head], currentX = position % width, currentY = Math.floor(position / width);
      if (protectedMask && protectedMask[position]) protectedWhite = true;
      offsets.forEach(([dx, dy]) => {
        const nearX = currentX + dx, nearY = currentY + dy;
        if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) return;
        const near = nearY * width + nearX;
        if (visited[near] || !output[nearY][nearX] || output[nearY][nearX][0] !== highlightColor[0]) return;
        visited[near] = 1; queue.push(near);
      });
    }
    if (protectedWhite || queue.length > 2) continue;
    const neighbors = new Map();
    queue.forEach(position => {
      const currentX = position % width, currentY = Math.floor(position / width);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const near = output[currentY + dy] && output[currentY + dy][currentX + dx];
        if (near && near[0] !== highlightColor[0]) neighbors.set(near[0], near);
      }
    });
    if (neighbors.size < 2) continue;
    const candidates = Array.from(neighbors.values()), candidatePrepared = preparePalette(candidates);
    queue.forEach(position => {
      const index = position * 4;
      const adjusted = adjustPixel([data[index], data[index + 1], data[index + 2]], options);
      output[Math.floor(position / width)][position % width] = nearest(adjusted, candidates, candidatePrepared);
    });
  }
  return output;
}

function mapPixels(data, width, height, palette, options = {}) {
  options = { ...options, sourceKind: inferSourceKind(data, width, height, options) };
  const prepared = preparePalette(palette);
  if (options.sourceKind === 'binary') {
    const binary = mapBinaryPixels(data, width, height, palette, options);
    if (binary) return binary;
  }
  const enclosingFrame = hasEnclosingDarkFrame(data, width, height);
  if (enclosingFrame) {
    options = { ...options, outlineMode: 'off', blackBoundary: false, ensureClosedBoundary: false };
  }
  const background = options.localBackground === false ? null : connectedBackgroundMask(data, width, height, options);
  // 外围强包边与内部自动描边只能二选一。强包边已经负责保证成品轮廓闭合，
  // 若再让 isOutlinePixel 扫描主体内部，深蓝制服、深棕头发等低亮度大色面
  // 会被当成“线条”整片染黑。真实眼睛、嘴巴和原有线条仍由色卡匹配及
  // preserveKeyFeatures 保留，不依赖这层二次描边。
  const adaptiveOutline = !enclosingFrame && !options.blackBoundary && options.preserveOutline !== false
    && (options.outlineMode === 'always' || (options.outlineMode !== 'off' && hasLightNeutralSubject(data, width, height, background)));
  const outlineColor = palette.slice().sort((a, b) => colorLuminance(a) - colorLuminance(b))[0];
  const highlightColor = palette.slice().sort((a, b) => colorLuminance(b) - colorLuminance(a))[0];
  const mapped = mapColorRegions(data, width, height, palette, prepared, options, background, adaptiveOutline, outlineColor, highlightColor);
  let finalProtectedMask = mapped.protectedMask;
  let output = finalizeMappedPattern(mapped, data, width, height, palette, prepared, options, background, adaptiveOutline, outlineColor);

  if (options.regionMode === 'rich') {
    output = stabilizeRichPalette(output, data, width, height, options, mapped.protectedMask, outlineColor, highlightColor);
  } else {
    // 组件清理发生在色块复用之后。极少数情况下，某个只存在于被清理小组件
    // 中的色号会被主组件借用，于是“减少颜色”虽然色数更少，却不再是最终
    // “丰富颜色”的严格子集。这里在同一输入上建立最终丰富基线，只把这种
    // 孤立色号映射到丰富结果已经使用的最近色；形状和大色块划分保持不变。
    const richOptions = { ...options, regionMode: 'rich' };
    const richMapped = mapColorRegions(data, width, height, palette, prepared, richOptions, background, adaptiveOutline, outlineColor, highlightColor);
    finalProtectedMask = richMapped.protectedMask;
    const richOutput = stabilizeRichPalette(
      finalizeMappedPattern(richMapped, data, width, height, palette, prepared, richOptions, background, adaptiveOutline, outlineColor),
      data,
      width,
      height,
      richOptions,
      richMapped.protectedMask,
      outlineColor,
      highlightColor
    );
    const allowedByCode = new Map();
    richOutput.forEach(row => row.forEach(color => { if (color) allowedByCode.set(color[0], color); }));
    const allowedPalette = Array.from(allowedByCode.values()), allowedPrepared = allowedPalette.length ? preparePalette(allowedPalette) : [];
    if (allowedPalette.length) output = output.map(row => row.map(color => color && !allowedByCode.has(color[0])
      ? nearest([color[2], color[3], color[4]], allowedPalette, allowedPrepared)
      : color));
    output = consolidateGlobalPalette(richOutput, output, data, width, height, options, richMapped.protectedMask, outlineColor, highlightColor);
  }
  return cleanFalseWhiteArtifacts(output, data, width, height, options, finalProtectedMask, highlightColor);
}

function recount(pattern, palette) {
  const counts = {};
  pattern.forEach(row => row.forEach(color => { if (color) counts[color[0]] = (counts[color[0]] || 0) + 1; }));
  const materials = Object.keys(counts).map(code => {
    let color = palette.find(item => item[0] === code);
    if (!color) {
      for (let y = 0; y < pattern.length && !color; y += 1) color = pattern[y].find(item => item && item[0] === code);
    }
    return { code, name: color[1], r: color[2], g: color[3], b: color[4], count: counts[code] };
  }).sort((a, b) => a.code.localeCompare(b.code, 'zh-CN', { numeric: true }));
  return { materials, total: materials.reduce((sum, item) => sum + item.count, 0) };
}

module.exports = {
  clamp, nearest, preparePalette, mapPixels, prepareSubjectSample, recount, rgbToLab,
  analyzeQrStructure, renderQrStructure, analyzeTwoColorStructure, inferSourceKind
};
