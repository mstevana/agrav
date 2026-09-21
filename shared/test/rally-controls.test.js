// The controls the lobby lists have to be the controls the game reads. They are
// written down in one place and acted on in another — a list and a run of ifs —
// so this presses everything the list claims and checks the right bit comes out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IN } from '../net/protocol.js';

// Input listens to the page and reads the gamepads; neither exists here, and
// neither is what is being tested. Stubbed before the module is loaded, since
// the constructor binds on the way up.
globalThis.addEventListener ??= () => {};
globalThis.navigator ??= {};
const { Input, CONTROLS, keyLabel } = await import('../../rally/src/input.js');

/** an Input with nothing bound to the page, holding exactly these keys */
function holding(...codes) {
  const i = new Input();
  i.enabled = true;
  for (const c of codes) i.keys.add(c);
  return i;
}

test('controls: every key the lobby lists does what the lobby says it does', () => {
  for (const c of CONTROLS) {
    if (!c.bit) continue;                      // steering is an axis, checked below
    for (const code of c.keys) {
      const bits = holding(code).sample(1 / 60).bits;
      assert.ok(bits & c.bit, `${c.what} says ${keyLabel(code)}, but holding it sets no such bit`);
    }
  }
});

test('controls: the steering keys steer, and the named side is the side it goes', () => {
  const left = ['ArrowLeft', 'KeyA'], right = ['ArrowRight', 'KeyD'];
  for (const code of left) {
    const i = holding(code);
    for (let n = 0; n < 30; n++) i.sample(1 / 60);
    assert.ok(i.sample(1 / 60).steer < -0.5, `${keyLabel(code)} should steer left`);
  }
  for (const code of right) {
    const i = holding(code);
    for (let n = 0; n < 30; n++) i.sample(1 / 60);
    assert.ok(i.sample(1 / 60).steer > 0.5, `${keyLabel(code)} should steer right`);
  }
  const listed = CONTROLS.find(c => c.what === 'Steer').keys;
  for (const code of [...left, ...right]) {
    assert.ok(listed.includes(code), `${keyLabel(code)} steers, and the list does not mention it`);
  }
  assert.equal(listed.length, left.length + right.length, 'and it mentions nothing that does not');
});

test('controls: nothing held is nothing asked for', () => {
  const i = holding();
  assert.equal(i.sample(1 / 60).bits, 0);
  assert.equal(i.sample(1 / 60).steer, 0);
});

test('controls: every action a car has is on the list', () => {
  const listed = new Set(CONTROLS.filter(c => c.bit).map(c => c.bit));
  for (const [name, bit] of [['THROTTLE', IN.THROTTLE], ['BRAKE', IN.BRAKE],
                             ['FIRE', IN.FIRE], ['MINE', IN.MINE], ['NITRO', IN.NITRO]]) {
    assert.ok(listed.has(bit), `${name} is something a car can do, and nothing tells the driver how`);
  }
});
