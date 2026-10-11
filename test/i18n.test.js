// Every text key the TV uses must exist in every language.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = {};
require('../tv/i18n.js');
const STR = global.window.STEADY_STRINGS;
const X = require('../shared/exercises.js');
const src = fs.readFileSync(path.join(__dirname, '../tv/app.js'), 'utf8');
const used = new Set([...src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]));
for (const id of Object.keys(X.EXERCISES)) { used.add(`ex_${id}`); used.add(`how_${id}`); }
for (const id of Object.keys(X.EXERCISES)) if (X.EXERCISES[id].kind === 'reps') { used.add(`cue_${id}`); used.add(`higher_${id}`); }
for (const n of [1, 2, 3, 4]) { used.add(`stage${n}Name`); used.add(`stage${n}Say`); }
for (const s of ['good', 'watch', 'talk', 'info']) { used.add(`status_${s}`); used.add(`advice_${s}`); }

for (const lang of Object.keys(STR)) {
  test(`all used keys exist in "${lang}"`, () => {
    const missing = [...used].filter((k) => !(k in STR[lang]));
    assert.deepEqual(missing, []);
  });
  test(`"${lang}" has the same keys as English and the same {placeholders}`, () => {
    assert.deepEqual(Object.keys(STR[lang]).sort(), Object.keys(STR.en).sort());
    for (const k of Object.keys(STR.en)) {
      const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(ph(STR[lang][k]), ph(STR.en[k]), `placeholders differ for ${k}`);
    }
  });
}
