import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineMediaTags, resolveMediaPath } from '../src/lib/chat-media.ts';

const ok = '/home/syafwan/.hermes/cache/scratch/mockup.png';

test('resolveMediaPath maps host folders to mounts', () => {
  assert.deepEqual(resolveMediaPath(ok), { file: '/media/scratch/mockup.png', type: 'image/png' });
  assert.deepEqual(resolveMediaPath('/home/syafwan/.hermes/cache/images/a/b.JPG'), { file: '/media/images/a/b.JPG', type: 'image/jpeg' });
});

test('resolveMediaPath refuses everything else', () => {
  for (const bad of [
    '/etc/passwd',
    '/home/syafwan/.hermes/.env',
    '/home/syafwan/.hermes/cache/scratch/../../.env.png',
    '/home/syafwan/.hermes/cache/scratch/x.svg',
    '/home/syafwan/.hermes/cache/scratch/x.txt',
    '/home/syafwan/.hermes/cache/scratch/',
    '/home/syafwan/.hermes/cache/scratch/a\0.png',
    '/home/syafwan/.hermes/cache/scratchy/x.png',
    'relative/x.png',
    '/home/syafwan/.hermes/cache/scratch\\..\\x.png',
    null,
    42,
  ]) assert.equal(resolveMediaPath(bad), null, String(bad));
});

test('inlineMediaTags turns allowed tags into images and leaves the rest', () => {
  const out = inlineMediaTags(`Ini mockup:\n\nMEDIA:${ok}\n\nSelesai`);
  assert.match(out, /!\[image\]\(\/api\/agent\/media\?path=%2Fhome%2Fsyafwan%2F\.hermes%2Fcache%2Fscratch%2Fmockup\.png\)/);
  assert.equal(inlineMediaTags('MEDIA:/etc/passwd.png'), 'MEDIA:/etc/passwd.png');
  assert.equal(inlineMediaTags('tidak ada tag'), 'tidak ada tag');
  assert.equal(inlineMediaTags('MEDIA:/home/syafwan/.hermes/cache/scratch/../../x.png'), 'MEDIA:/home/syafwan/.hermes/cache/scratch/../../x.png');
});
