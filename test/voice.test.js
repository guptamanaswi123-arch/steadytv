const test = require('node:test');
const assert = require('node:assert');
const V = require('../shared/voice.js');

test('English commands', () => {
  assert.equal(V.parse('Start'), 'enter');
  assert.equal(V.parse('okay, next please'), 'enter');
  assert.equal(V.parse('yes'), 'enter');
  assert.equal(V.parse('Stop!'), 'back');
  assert.equal(V.parse('go back'), 'back');
  assert.equal(V.parse('cancel'), 'back');
  assert.equal(V.parse('move down'), 'down');
  assert.equal(V.parse('left'), 'left');
  assert.equal(V.parse('repeat that'), 'repeat');
  assert.equal(V.parse('mute'), 'mute');
  assert.equal(V.parse('unmute'), 'unmute');
});

test('Hindi commands', () => {
  assert.equal(V.parse('शुरू करो'), 'enter');
  assert.equal(V.parse('आगे'), 'enter');
  assert.equal(V.parse('हाँ'), 'enter');
  assert.equal(V.parse('रुको'), 'back');
  assert.equal(V.parse('पीछे जाओ'), 'back');
  assert.equal(V.parse('नीचे'), 'down');
  assert.equal(V.parse('फिर से बोलो'), 'repeat');
  assert.equal(V.parse('आवाज़ बंद'), 'mute');
  assert.equal(V.parse('स्टार्ट'), 'enter');
  assert.equal(V.parse('स्टॉप'), 'back');
});

test('whole words only, unknown speech is ignored', () => {
  assert.equal(V.parse('nothing'), null);        // contains "no" but is not the word "no"
  assert.equal(V.parse('the weather is nice'), null);
  assert.equal(V.parse('gone'), null);           // contains "go" but is not the word "go"
  assert.equal(V.parse(''), null);
  assert.equal(V.parse(undefined), null);
});

test('"go back" is back, not enter', () => {
  assert.equal(V.parse('please go back'), 'back');
  assert.equal(V.parse('no stop'), 'back');
});
