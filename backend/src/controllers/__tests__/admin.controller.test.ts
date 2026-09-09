import { describe, it, expect } from 'vitest';
import {
  extensionOf,
  isAllowedUpload,
  buildObjectKey,
  isMintedObjectKey,
  isObjectKey,
  isAllowedAvatar,
  buildAvatarKey,
  isMintedAvatarKey,
  allowedAvatarExtensions,
  AVATAR_MAX_BYTES,
} from '../../services/storage';

describe('extensionOf', () => {
  it('lowercases so .PDF is treated as .pdf', () => {
    expect(extensionOf('Notes.PDF')).toBe('.pdf');
  });

  it('takes the final extension of a double-barrelled name', () => {
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
  });

  it('is empty for a name with no extension', () => {
    expect(extensionOf('README')).toBe('');
  });
});

describe('isAllowedUpload', () => {
  it.each(['lesson.pdf', 'clip.mp4', 'clip.webm', 'clip.mov', 'SHOUTED.PDF'])(
    'accepts %s',
    (name) => expect(isAllowedUpload(name)).toBe(true)
  );

  it.each(['payload.exe', 'script.sh', 'image.png', 'page.html', 'noextension'])(
    'rejects %s',
    (name) => expect(isAllowedUpload(name)).toBe(false)
  );

  it('rejects a disallowed type disguised by a leading allowed one', () => {
    // Only the trailing extension decides, so "cv.pdf.exe" is an .exe.
    expect(isAllowedUpload('cv.pdf.exe')).toBe(false);
  });
});

describe('buildObjectKey', () => {
  it('namespaces uploads under lessons/ and keeps the extension', () => {
    const key = buildObjectKey('Notes.PDF');

    expect(key.startsWith('lessons/')).toBe(true);
    expect(key.endsWith('.pdf')).toBe(true);
  });

  it('never reuses a key for the same filename', () => {
    expect(buildObjectKey('notes.pdf')).not.toBe(buildObjectKey('notes.pdf'));
  });

  it('drops the original filename so it cannot be guessed', () => {
    expect(buildObjectKey('confidential-exam-answers.pdf')).not.toContain(
      'confidential'
    );
  });
});

describe('isObjectKey', () => {
  it('treats an R2 key as needing a signed URL', () => {
    expect(isObjectKey('lessons/2f1a-4c.pdf')).toBe(true);
  });

  it.each(['/sample-lesson.pdf', 'https://cdn.example.com/a.pdf', 'http://x/y.pdf'])(
    'leaves the ready-made location %s alone',
    (value) => expect(isObjectKey(value)).toBe(false)
  );
});

/**
 * The browser uploads straight to storage and hands the key back, so
 * `attachLessonMedia` receives it as untrusted input. Whatever is stored is
 * later signed into a download URL for every enrolled learner, so the key has
 * to be provably one this server minted — a `lessons/` prefix test is not.
 */
describe('isMintedObjectKey', () => {
  it.each(['notes.pdf', 'clip.mp4', 'clip.webm', 'clip.mov'])(
    'accepts the key it just minted for %s',
    (filename) => expect(isMintedObjectKey(buildObjectKey(filename))).toBe(true)
  );

  it('rejects a traversal that satisfies a prefix check', () => {
    expect(isMintedObjectKey('lessons/../billing/export.pdf')).toBe(false);
  });

  it.each([
    'lessons/anything.pdf', // not a UUID
    'lessons/2f1a-4c.pdf', // truncated UUID
    'lessons/8f14e45f-ceea-467a-9f5a-8b0a1f0a1b2c.exe', // disallowed type
    'lessons/8f14e45f-ceea-467a-9f5a-8b0a1f0a1b2c.pdf.exe', // double extension
    'lessons/8f14e45f-ceea-467a-9f5a-8b0a1f0a1b2c.pdf/../../secret', // suffixed
    'billing/8f14e45f-ceea-467a-9f5a-8b0a1f0a1b2c.pdf', // outside the namespace
    'lessons/8F14E45F-CEEA-467A-9F5A-8B0A1F0A1B2C.pdf', // not what randomUUID emits
    '',
  ])('rejects %s', (key) => expect(isMintedObjectKey(key)).toBe(false));

  it('anchors both ends so a valid key cannot be smuggled inside a longer one', () => {
    const valid = buildObjectKey('notes.pdf');

    expect(isMintedObjectKey(`x${valid}`)).toBe(false);
    expect(isMintedObjectKey(`${valid}x`)).toBe(false);
    expect(isMintedObjectKey(`${valid}\n${valid}`)).toBe(false);
  });

  it('rejects a trailing newline', () => {
    // JavaScript's `$` does not match before a trailing newline the way Perl's
    // and Python's do — but adding an `m` flag to the pattern would change that
    // and quietly reopen the hole, so pin the behaviour.
    const valid = buildObjectKey('notes.pdf');

    expect(isMintedObjectKey(`${valid}\n`)).toBe(false);
    expect(isMintedObjectKey(`${valid}\r\n`)).toBe(false);
  });
});

describe('isAllowedAvatar', () => {
  it.each(['me.jpg', 'me.jpeg', 'me.png', 'SHOUTED.PNG'])('accepts %s', (name) =>
    expect(isAllowedAvatar(name)).toBe(true)
  );

  it.each(['me.svg', 'me.gif', 'me.webp', 'me.pdf', 'me.mp4', 'noextension'])(
    'rejects %s',
    (name) => expect(isAllowedAvatar(name)).toBe(false)
  );

  it('rejects an SVG disguised by a leading allowed extension', () => {
    // SVG carries script, so it is the one image type deliberately left out.
    expect(isAllowedAvatar('me.png.svg')).toBe(false);
  });

  it('offers exactly the formats the Change Photo screen promises', () => {
    expect(allowedAvatarExtensions().sort()).toEqual(['.jpeg', '.jpg', '.png']);
  });

  it('caps uploads at the 5MB the screen promises', () => {
    expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('buildAvatarKey', () => {
  it('namespaces photos away from lesson media', () => {
    const key = buildAvatarKey('Selfie.JPG');

    expect(key.startsWith('avatars/')).toBe(true);
    expect(key.endsWith('.jpg')).toBe(true);
  });

  it('never reuses a key for the same filename', () => {
    expect(buildAvatarKey('me.png')).not.toBe(buildAvatarKey('me.png'));
  });
});

describe('isMintedAvatarKey', () => {
  it('accepts a key it just minted', () => {
    expect(isMintedAvatarKey(buildAvatarKey('me.png'))).toBe(true);
  });

  it('rejects a traversal that merely starts with the prefix', () => {
    expect(isMintedAvatarKey('avatars/../lessons/paid-course.pdf')).toBe(false);
  });

  it('rejects a lesson key offered as a profile photo', () => {
    expect(isMintedAvatarKey(buildObjectKey('notes.pdf'))).toBe(false);
  });

  it('rejects a well-formed key with a disallowed extension', () => {
    expect(
      isMintedAvatarKey('avatars/11111111-1111-1111-1111-111111111111.svg')
    ).toBe(false);
  });

  it('rejects a key whose id is not a uuid', () => {
    expect(isMintedAvatarKey('avatars/me.png')).toBe(false);
  });
});
