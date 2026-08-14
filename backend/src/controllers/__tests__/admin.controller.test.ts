import { describe, it, expect } from 'vitest';
import { extensionOf, isAllowedUpload, buildObjectKey } from '../admin.controller';

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
