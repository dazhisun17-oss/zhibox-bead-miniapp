const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'apps/wechat/miniprogram/pages/beads/beads.js'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'apps/wechat/miniprogram/pages/beads/beads.wxml'), 'utf8');

const checks = [
  ['default edit lock', /patternEditLocked:\s*true/.test(js)],
  ['locked edit guard', /this\.data\.patternEditLocked\s*\|\|\s*Date\.now\(\)</.test(js)],
  ['movement threshold', />8\)/.test(js)],
  ['post gesture cooldown', /_suppressPatternEditUntil=Date\.now\(\)\+450/.test(js)],
  ['scale cooldown', /_suppressPatternEditUntil=Date\.now\(\)\+500/.test(js)],
  ['lock toggle', /togglePatternEditLock\(\)/.test(js)],
  ['touch hooks', /bindtouchstart="patternTouchStart"/.test(wxml) && /bindtouchmove="patternTouchMove"/.test(wxml)],
  ['smooth movement settings', /damping="35"/.test(wxml) && /friction="2"/.test(wxml)],
  ['lock control', /pattern-lock/.test(wxml) && /修改已锁定/.test(wxml)]
];

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
assert.deepStrictEqual(failures, []);
console.log(JSON.stringify({ ok: true, checks: checks.length, failures }, null, 2));
