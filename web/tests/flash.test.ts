import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLASH_KEY, FLASH_MAX_AGE_MS, saveFlash, takeFlash, type FlashStore } from '../src/lib/flash.ts';

const memory = (): FlashStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

test('a saved message is shown once, then gone', () => {
  const store = memory();
  saveFlash(store, 'Budget line added', 'success', 1000);
  assert.deepEqual(takeFlash(store, 1500), { message: 'Budget line added', kind: 'success', at: 1000 });
  assert.equal(takeFlash(store, 1600), null);
  assert.equal(store.map.has(FLASH_KEY), false);
});

test('nothing saved means nothing to show', () => {
  assert.equal(takeFlash(memory()), null);
});

test('an old message is dropped (and cleared)', () => {
  const store = memory();
  saveFlash(store, 'old', 'info', 1000);
  assert.equal(takeFlash(store, 1000 + FLASH_MAX_AGE_MS + 1), null);
  assert.equal(store.map.has(FLASH_KEY), false);
});

test('a message dated in the future is not trusted', () => {
  const store = memory();
  saveFlash(store, 'later', 'info', 100_000);
  assert.equal(takeFlash(store, 1000), null);
});

test('garbage in storage is ignored', () => {
  for (const raw of ['{not json', '[]', '{"message":"x"}', '{"message":"","kind":"success","at":1}', '{"message":"x","kind":"danger","at":1}', '"text"']) {
    const store = memory();
    store.map.set(FLASH_KEY, raw);
    assert.equal(takeFlash(store, 2), null, raw);
  }
});

test('long messages are cut, errors keep their kind', () => {
  const store = memory();
  saveFlash(store, 'x'.repeat(1000), 'error', 5);
  const flash = takeFlash(store, 6)!;
  assert.equal(flash.message.length, 300);
  assert.equal(flash.kind, 'error');
});

test('a broken store does not throw', () => {
  const broken: FlashStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => saveFlash(broken, 'x'));
  assert.equal(takeFlash(broken), null);
});
