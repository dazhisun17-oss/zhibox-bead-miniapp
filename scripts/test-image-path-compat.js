const assert = require('assert');

const virtualFiles = {};
const fsMock = {
  readFile({ filePath, success, fail }) { return virtualFiles[filePath] ? success({ data: virtualFiles[filePath] }) : fail(new Error('missing')); }
};
global.wx = {
  getFileSystemManager: () => fsMock,
  getDeviceInfo: () => ({ platform: 'android' }),
  compressImage: ({ src, quality, success }) => success({ tempFilePath: `${src}.${quality}.jpg` }),
  createOffscreenCanvas: ({ width, height }) => {
    const target = { width, height, pixels: null };
    target.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: imageData => { target.pixels = imageData.data; }
    });
    return target;
  }
};
const { imageExtension, decodePngToOffscreenCanvas } = require('../apps/wechat/miniprogram/utils/canvas');
const { detectImageExtension, pngPixelCount, decodePngRgba, normalizePngArrayBuffer, compressToWechatImage } = require('../apps/wechat/miniprogram/utils/files');
const upngModule = require('../apps/wechat/miniprogram/node_modules/@pdf-lib/upng');
const UPNG = upngModule.default || upngModule;

assert.strictEqual(imageExtension({ type: 'PNG' }, 'comment_123.PNG'), 'png');
assert.strictEqual(imageExtension({ type: 'JPEG' }, 'cloud-content'), 'jpg');
assert.strictEqual(imageExtension({}, 'wxfile://tmp/photo.JPEG'), 'jpg');
assert.strictEqual(imageExtension({}, 'content://media/external/123'), 'png');
assert.strictEqual(imageExtension({ type: 'HEIF' }, 'IMG_1'), 'heic');
assert.strictEqual(detectImageExtension(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).buffer, 'wrong.JPG'), 'png');
assert.strictEqual(detectImageExtension(Uint8Array.from([0xff,0xd8,0xff,0xe0]).buffer, 'wrong.PNG'), 'jpg');
assert.strictEqual(detectImageExtension(Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]).buffer, ''), 'webp');

const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128]);
const palettePng = UPNG.encode([rgba.buffer], 2, 1, 2);
const normalizedPng = normalizePngArrayBuffer(palettePng);
const decoded = UPNG.decode(normalizedPng);
const directPixels = decodePngRgba(palettePng);
assert.strictEqual(pngPixelCount(normalizedPng), 2);
assert.strictEqual(decoded.width, 2);
assert.strictEqual(decoded.height, 1);
assert.strictEqual(decoded.ctype, 6);
assert.strictEqual(decoded.depth, 8);
assert.deepStrictEqual(Array.from(new Uint8Array(UPNG.toRGBA8(decoded)[0])), Array.from(rgba));
assert.strictEqual(directPixels.width, 2);
assert.strictEqual(directPixels.height, 1);
assert.deepStrictEqual(Array.from(new Uint8Array(directPixels.data)), Array.from(rgba));

virtualFiles['/problem.png'] = palettePng;
decodePngToOffscreenCanvas('/problem.png').then(async offscreen => {
  assert.strictEqual(offscreen.width, 2);
  assert.strictEqual(offscreen.height, 1);
  assert.deepStrictEqual(Array.from(offscreen.pixels), Array.from(rgba));
  assert.strictEqual(await compressToWechatImage('/provider/image.avif'), '/provider/image.avif.100.jpg');
  console.log(JSON.stringify({ ok: true, checks: 21 }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
