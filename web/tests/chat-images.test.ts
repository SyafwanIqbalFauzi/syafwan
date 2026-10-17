import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunInput, fitWithin, imageSourcesOf, MAX_IMAGES, parseImages, textOfContent } from '../src/lib/chat-images.ts';

const png = 'data:image/png;base64,iVBORw0KGgo=';

test('parseImages accepts none, rejects bad shapes', () => {
  assert.deepEqual(parseImages(undefined), { ok: true, images: [] });
  assert.deepEqual(parseImages([png]), { ok: true, images: [png] });
  assert.equal(parseImages('x').ok, false);
  assert.equal(parseImages([123]).ok, false);
  assert.equal(parseImages(['data:image/svg+xml;base64,PHN2Zz4=']).ok, false);
  assert.equal(parseImages(['data:text/html;base64,PGI+']).ok, false);
  assert.equal(parseImages(['https://example.com/a.png']).ok, false);
});

test('parseImages enforces count and size', () => {
  assert.equal(parseImages(Array(MAX_IMAGES + 1).fill(png)).ok, false);
  assert.equal(parseImages(Array(MAX_IMAGES).fill(png)).ok, true);
  const big = 'data:image/png;base64,' + 'A'.repeat(3_600_000);
  assert.equal(parseImages([big]).ok, false);
  const mid = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
  assert.equal(parseImages([mid, mid, mid]).ok, false);
});

test('buildRunInput: text only stays a string; images make one user message', () => {
  assert.equal(buildRunInput('hi', []), 'hi');
  const input = buildRunInput('look', [png]) as any;
  assert.equal(input.length, 1);
  assert.equal(input[0].role, 'user');
  assert.deepEqual(input[0].content, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: png } }]);
  const imageOnly = buildRunInput('  ', [png]) as any;
  assert.equal(imageOnly[0].content.length, 1);
});

test('imageSourcesOf only lets safe sources through', () => {
  const content = [
    { type: 'text', text: 'a' },
    { type: 'image_url', image_url: { url: png } },
    { type: 'input_image', image_url: 'https://example.com/x.jpg' },
    { type: 'image_url', image_url: { url: 'javascript:alert(1)' } },
    { type: 'image_url', image_url: { url: 'http://example.com/x.jpg' } },
    { type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,PHN2Zz4=' } },
  ];
  assert.deepEqual(imageSourcesOf(content), [png, 'https://example.com/x.jpg']);
  assert.deepEqual(imageSourcesOf('plain'), []);
});

test('textOfContent ignores image parts', () => {
  assert.equal(textOfContent('hi'), 'hi');
  assert.equal(textOfContent([{ type: 'text', text: 'a' }, { type: 'image_url', image_url: { url: png } }, 'b']), 'ab');
});

test('fitWithin scales down only', () => {
  assert.deepEqual(fitWithin(4000, 2000, 1600), { width: 1600, height: 800 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1000, 3000, 1500), { width: 500, height: 1500 });
});
