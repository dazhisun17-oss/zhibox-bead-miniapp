const { promisify, readArrayBuffer, detectImageExtension, normalizePngArrayBuffer, decodePngRgba, compressToWechatImage } = require('./files');

function queryCanvas(page, selector) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select(selector).fields({ node: true, size: true }).exec(result => {
      if (!result || !result[0] || !result[0].node) return reject(new Error('画布初始化失败'));
      resolve(result[0]);
    });
  });
}

function tryCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = error => reject(error || new Error('image_decode_failed'));
    image.src = src;
  });
}

function imageExtension(info = {}, src = '') {
  const aliases = { jpeg: 'jpg', jpe: 'jpg', heif: 'heic' };
  const declared = String(info.type || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (declared) return aliases[declared] || declared;
  const match = String(src).match(/\.([a-z0-9]+)(?:\?|$)/i);
  const extension = match ? match[1].toLowerCase() : 'png';
  return aliases[extension] || extension;
}

function copyAsStandardImage(src, extension) {
  const filePath = `${wx.env.USER_DATA_PATH}/image-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().copyFile({ srcPath: src, destPath: filePath, success: () => resolve(filePath), fail: reject });
  });
}

async function transcodePngToLocalFile(src) {
  const data = await readArrayBuffer(src);
  if (detectImageExtension(data, src) !== 'png') throw new Error('not_png');
  const normalized = normalizePngArrayBuffer(data);
  const filePath = `${wx.env.USER_DATA_PATH}/decoded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  await new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({ filePath, data: normalized, success: resolve, fail: reject });
  });
  return filePath;
}

async function decodePngToOffscreenCanvas(src) {
  if (typeof wx.createOffscreenCanvas !== 'function') throw new Error('offscreen_canvas_unavailable');
  const data = await readArrayBuffer(src);
  if (detectImageExtension(data, src) !== 'png') throw new Error('not_png');
  const decoded = decodePngRgba(data);
  const offscreen = wx.createOffscreenCanvas({ type: '2d', width: decoded.width, height: decoded.height });
  offscreen.width = decoded.width;
  offscreen.height = decoded.height;
  const ctx = offscreen.getContext('2d');
  if (!ctx || typeof ctx.putImageData !== 'function') throw new Error('offscreen_context_unavailable');
  let imageData;
  if (typeof ctx.createImageData === 'function') imageData = ctx.createImageData(decoded.width, decoded.height);
  else if (typeof ctx.getImageData === 'function') imageData = ctx.getImageData(0, 0, decoded.width, decoded.height);
  if (!imageData || !imageData.data || typeof imageData.data.set !== 'function') throw new Error('image_data_unavailable');
  imageData.data.set(new Uint8ClampedArray(decoded.data));
  ctx.putImageData(imageData, 0, 0);
  return offscreen;
}

async function loadCanvasImage(canvas, src) {
  if (!src) throw new Error('图片路径为空，请重新选择图片');
  const failures = [];
  let actualType = 'unknown';
  try { actualType = detectImageExtension(await readArrayBuffer(src), src); } catch (_) { failures.push('read'); }
  try { return await tryCanvasImage(canvas, src); } catch (_) { failures.push('direct'); }

  let info = {};
  try { info = await promisify(wx.getImageInfo, { src }); } catch (_) {}
  const normalizedPath = info.path || '';
  if (normalizedPath && normalizedPath !== src) {
    try { return await tryCanvasImage(canvas, normalizedPath); } catch (_) { failures.push('info'); }
  }

  // Android's gallery can display AVIF/HEIF/WebP/JPEG variants that CanvasImage cannot.
  // wx.compressImage delegates decoding to the native image pipeline and returns a
  // WeChat-owned temporary image, which also avoids content-provider path restrictions.
  try {
    const convertedPath = await compressToWechatImage(normalizedPath || src);
    try { return await tryCanvasImage(canvas, convertedPath); } catch (_) {
      if (detectImageExtension(await readArrayBuffer(convertedPath), convertedPath) === 'png') {
        return await decodePngToOffscreenCanvas(convertedPath);
      }
      failures.push('native-load');
    }
  } catch (_) { failures.push('native'); }

  // Some Android galleries expose cloud/content-provider images with an uppercase or
  // extensionless filename. The system preview can display them, while Canvas createImage
  // rejects the provider path. Copying the authorized temporary file to the app's local
  // directory with a normalized lowercase extension gives Canvas a stable file path.
  const source = normalizedPath || src, extension = imageExtension(info, source);
  try {
    const localPath = await copyAsStandardImage(source, extension);
    return await tryCanvasImage(canvas, localPath);
  } catch (_) { failures.push('copy'); }

  // Copying only changes the path. If Android still rejects the file, decode the PNG
  // in JavaScript and write a clean 8-bit RGBA PNG before one final CanvasImage load.
  try {
    const decodedPath = await transcodePngToLocalFile(source);
    return await tryCanvasImage(canvas, decodedPath);
  } catch (_) { failures.push('png-file'); }

  // Last resort for affected Android builds: bypass CanvasImage decoding entirely.
  // A 2D offscreen canvas is a valid drawImage source and already contains RGBA pixels.
  try { return await decodePngToOffscreenCanvas(source); } catch (_) { failures.push('png-pixels'); }
  throw new Error(`图片读取失败 E48：${actualType}/${failures.join('-')}`);
}

function canvasToFile(page, canvas, options = {}) {
  return promisify(wx.canvasToTempFilePath, {
    canvas,
    fileType: options.fileType || 'png',
    quality: options.quality == null ? 1 : options.quality,
    destWidth: options.destWidth || canvas.width,
    destHeight: options.destHeight || canvas.height,
    ...options
  });
}

module.exports = { queryCanvas, loadCanvasImage, canvasToFile, imageExtension, transcodePngToLocalFile, decodePngToOffscreenCanvas };
