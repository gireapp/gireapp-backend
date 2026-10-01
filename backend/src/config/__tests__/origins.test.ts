import { describe, it, expect } from 'vitest';
import { parseFrontendOrigin, parseCorsOrigins } from '../origins';

describe('parseFrontendOrigin', () => {
  it('keeps a single configured origin', () => {
    expect(parseFrontendOrigin('https://app.gireapp.com')).toBe('https://app.gireapp.com');
  });

  it('refuses a list, because emailed links are built from this value', () => {
    expect(() =>
      parseFrontendOrigin('https://app.gireapp.com,https://staging.gireapp.com')
    ).toThrowError(/single origin/i);
  });

  it('points at the CORS_ORIGINS replacement so the fix is obvious', () => {
    expect(() => parseFrontendOrigin('https://a.com,https://b.com')).toThrowError(/CORS_ORIGINS/);
  });

  it('drops a trailing slash that would double up in every link', () => {
    expect(parseFrontendOrigin('https://app.gireapp.com/')).toBe('https://app.gireapp.com');
  });

  it('falls back to localhost when unset or blank', () => {
    expect(parseFrontendOrigin(undefined)).toBe('http://localhost:3000');
    expect(parseFrontendOrigin('   ')).toBe('http://localhost:3000');
  });

  it('trims surrounding whitespace', () => {
    expect(parseFrontendOrigin('  https://app.gireapp.com  ')).toBe('https://app.gireapp.com');
  });
});

describe('parseCorsOrigins', () => {
  const FRONTEND = 'https://app.gireapp.com';

  it('allows the frontend origin alone when CORS_ORIGINS is unset', () => {
    expect(parseCorsOrigins(undefined, FRONTEND)).toEqual([FRONTEND]);
  });

  it('splits a list and trims each entry', () => {
    expect(parseCorsOrigins('https://a.com, https://b.com', FRONTEND)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('normalises trailing slashes so an Origin header still matches', () => {
    // Browsers send "https://a.com", never "https://a.com/".
    expect(parseCorsOrigins('https://a.com/', FRONTEND)).toEqual(['https://a.com']);
  });

  it('ignores empty entries from a stray comma', () => {
    expect(parseCorsOrigins('https://a.com,,', FRONTEND)).toEqual(['https://a.com']);
  });

  it('falls back to the frontend origin when the list is blank', () => {
    expect(parseCorsOrigins('  ', FRONTEND)).toEqual([FRONTEND]);
    expect(parseCorsOrigins(',', FRONTEND)).toEqual([FRONTEND]);
  });
});
