const INDEX_KEY = 'samvibe-bead-history-v2';
const PREFIX = 'samvibe-bead-project-';

function list() {
  try { return wx.getStorageSync(INDEX_KEY) || []; } catch (_) { return []; }
}

function save(project) {
  const id = project.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const index = list().filter(item => item.id !== id);
  const summary = { id, type: project.type, title: project.title, width: project.width, height: project.height, brand: project.brand, createdAt: project.createdAt || Date.now(), thumbnailPath: project.thumbnailPath || '' };
  index.unshift(summary);
  try {
    wx.setStorageSync(`${PREFIX}${id}`, { ...project, id });
    wx.setStorageSync(INDEX_KEY, index);
  } catch (_) {}
  return summary;
}

function update(id, changes) {
  try {
    const index = list(), position = index.findIndex(item => item.id === id);
    if (position < 0) return null;
    index[position] = { ...index[position], ...changes, id };
    const project = load(id);
    if (project) wx.setStorageSync(`${PREFIX}${id}`, { ...project, ...changes, id });
    wx.setStorageSync(INDEX_KEY, index);
    return index[position];
  } catch (_) { return null; }
}

function removeFile(path) {
  if (!path) return;
  try { wx.getFileSystemManager().unlinkSync(path); } catch (_) {}
}

function load(id) {
  try { return wx.getStorageSync(`${PREFIX}${id}`) || null; } catch (_) { return null; }
}

function remove(id) {
  try {
    const item = list().find(entry => entry.id === id);
    const project = load(id);
    removeFile((project && project.thumbnailPath) || (item && item.thumbnailPath));
    wx.removeStorageSync(`${PREFIX}${id}`);
    wx.setStorageSync(INDEX_KEY, list().filter(item => item.id !== id));
  } catch (_) {}
}

function clear() {
  list().forEach(item => {
    try {
      const project = load(item.id);
      removeFile((project && project.thumbnailPath) || item.thumbnailPath);
      wx.removeStorageSync(`${PREFIX}${item.id}`);
    } catch (_) {}
  });
  try { wx.removeStorageSync(INDEX_KEY); } catch (_) {}
}

module.exports = { list, save, update, load, remove, clear };
