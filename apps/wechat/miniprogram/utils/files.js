const fs = wx.getFileSystemManager();

let pngCodec;
function getPngCodec() {
  if (!pngCodec) {
    const module = require('@pdf-lib/upng');
    pngCodec = module.default || module;
  }
  return pngCodec;
}

function promisify(api, options = {}) {
  return new Promise((resolve, reject) => api({ ...options, success: resolve, fail: reject }));
}

function extOf(path = '') {
  const match = path.match(/\.([a-z0-9]+)(?:\?|$)/i);
  return match ? match[1].toLowerCase() : '';
}

function safeName(name = 'samvibe-file') {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-');
}

function writeUserFile(name, data, encoding) {
  const path = `${wx.env.USER_DATA_PATH}/${Date.now()}-${safeName(name)}`;
  return new Promise((resolve, reject) => {
    fs.writeFile({ filePath: path, data, encoding, success: () => resolve(path), fail: reject });
  });
}

async function openDocument(path, fileType, showMenu = true) {
  return promisify(wx.openDocument, { filePath: path, fileType, showMenu });
}

async function ensureAlbumPermission() {
  const setting = await promisify(wx.getSetting);
  if (setting.authSetting['scope.writePhotosAlbum'] === false) {
    const modal = await promisify(wx.showModal, {
      title: '需要相册权限',
      content: '请在设置中允许保存图片，SamVibe 只会保存你主动导出的结果。',
      confirmText: '去设置'
    });
    if (!modal.confirm) throw new Error('permission_denied');
    await promisify(wx.openSetting);
  }
}

async function saveImage(path) {
  await ensureAlbumPermission();
  await promisify(wx.saveImageToPhotosAlbum, { filePath: path });
  wx.showToast({ title: '已保存到相册', icon: 'success' });
}

function readArrayBuffer(path) {
  return new Promise((resolve, reject) => fs.readFile({ filePath: path, success: r => resolve(r.data), fail: reject }));
}

function detectImageExtension(data, fallbackPath = '') {
  const bytes = new Uint8Array(data || new ArrayBuffer(0));
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') return 'gif';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (/heic|heix|hevc|hevx|mif1|msf1/.test(brand)) return 'heic';
    if (/avif|avis/.test(brand)) return 'avif';
  }
  const extension = extOf(fallbackPath);
  return { jpeg: 'jpg', jpe: 'jpg', heif: 'heic' }[extension] || extension || 'png';
}

function pngPixelCount(data) {
  const bytes = new Uint8Array(data || new ArrayBuffer(0));
  if (bytes.length < 24 || detectImageExtension(data) !== 'png') return 0;
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  return width * height;
}

function decodePngRgba(data) {
  const UPNG = getPngCodec();
  const decoded = UPNG.decode(data);
  const pixels = decoded.width * decoded.height;
  if (!decoded.width || !decoded.height || pixels > 12000000) {
    throw new Error('PNG 图片尺寸过大，无法安全转换');
  }
  const frames = UPNG.toRGBA8(decoded);
  if (!frames || !frames[0]) throw new Error('PNG 图片没有可读取的画面');
  return { width: decoded.width, height: decoded.height, data: frames[0] };
}

function normalizePngArrayBuffer(data) {
  const UPNG = getPngCodec();
  const decoded = decodePngRgba(data);
  // Force a plain, non-interlaced, 8-bit RGBA PNG. This removes ancillary chunks
  // and palette/bit-depth variants that Android WeChat CanvasImage may reject.
  return UPNG.encode([decoded.data], decoded.width, decoded.height, 0, undefined, undefined, true);
}

function isAndroidDevice() {
  try {
    if (typeof wx.getDeviceInfo === 'function') return String(wx.getDeviceInfo().platform).toLowerCase() === 'android';
    return String(wx.getSystemInfoSync().platform).toLowerCase() === 'android';
  } catch (_) { return false; }
}

async function compressToWechatImage(sourcePath) {
  if (typeof wx.compressImage !== 'function') throw new Error('compress_api_unavailable');
  const result = await promisify(wx.compressImage, { src: sourcePath, quality: 100 });
  if (!result || !result.tempFilePath) throw new Error('compress_path_missing');
  return result.tempFilePath;
}

async function cacheImageForProcessing(sourcePath) {
  if (!sourcePath) throw new Error('图片路径为空，请重新选择图片');
  let readablePath = sourcePath, data;
  try { data = await readArrayBuffer(readablePath); } catch (_) {
    let info;
    try { info = await promisify(wx.getImageInfo, { src: sourcePath }); } catch (_) {}
    readablePath = info && info.path ? info.path : sourcePath;
    try { data = await readArrayBuffer(readablePath); } catch (_) {
      throw new Error('安卓相册图片读取失败，请确认原图已下载到本机');
    }
  }
  let extension = detectImageExtension(data, readablePath);
  if (extension === 'png' && isAndroidDevice() && pngPixelCount(data) <= 12000000) {
    try {
      data = normalizePngArrayBuffer(data);
    } catch (error) {
      throw new Error(`PNG 编码转换失败：${error && error.message ? error.message : '图片数据异常'}`);
    }
  } else if (isAndroidDevice()) {
    // Some Android galleries label files as PNG while the bytes are AVIF/HEIF/WebP.
    // Ask the system image pipeline to produce a WeChat-owned compatible temp image.
    try {
      const convertedPath = await compressToWechatImage(sourcePath);
      data = await readArrayBuffer(convertedPath);
      readablePath = convertedPath;
      extension = detectImageExtension(data, convertedPath);
    } catch (_) {}
  }
  const path = `${wx.env.USER_DATA_PATH}/import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  await new Promise((resolve, reject) => fs.writeFile({ filePath: path, data, success: resolve, fail: reject }));
  return path;
}

function removeLocalFile(path) {
  if (!path || String(path).indexOf(wx.env.USER_DATA_PATH) !== 0) return Promise.resolve();
  return new Promise(resolve => fs.unlink({ filePath: path, success: resolve, fail: resolve }));
}

function readBase64(path) {
  return new Promise((resolve, reject) => fs.readFile({ filePath: path, encoding: 'base64', success: r => resolve(r.data), fail: reject }));
}

function fileInfo(path) {
  return new Promise((resolve, reject) => fs.getFileInfo({ filePath: path, success: resolve, fail: reject }));
}

function copyFile(srcPath, name) {
  const destPath = `${wx.env.USER_DATA_PATH}/${Date.now()}-${safeName(name)}`;
  return new Promise((resolve, reject) => fs.copyFile({ srcPath, destPath, success: () => resolve(destPath), fail: reject }));
}

async function shareFile(filePath, fileName) {
  if (typeof wx.shareFileMessage === 'function') {
    return promisify(wx.shareFileMessage, { filePath, fileName: safeName(fileName) });
  }
  await promisify(wx.showModal, {
    title: '文件已生成',
    content: '当前微信版本不支持直接转发此文件，请升级微信后重试。',
    showCancel: false
  });
}

module.exports = {
  fs, promisify, extOf, safeName, writeUserFile, openDocument, saveImage,
  readArrayBuffer, readBase64, fileInfo, copyFile, shareFile,
  detectImageExtension, pngPixelCount, decodePngRgba, normalizePngArrayBuffer, compressToWechatImage,
  cacheImageForProcessing, removeLocalFile
};
