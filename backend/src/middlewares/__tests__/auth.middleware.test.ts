import { describe, it, expect } from 'vitest';
import { isTokenStale } from '../auth.middleware';

/** JWT `iat` is whole seconds since the epoch. */
function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

const RESET_AT = new Date('2026-08-13T10:00:00.000Z');

describe('isTokenStale', () => {
  it('accepts any token when the password has never been changed', () => {
    expect(isTokenStale(seconds(RESET_AT), null)).toBe(false);
  });

  it('rejects a token minted before the reset', () => {
    const anHourEarlier = new Date(RESET_AT.getTime() - 60 * 60 * 1000);

    expect(isTokenStale(seconds(anHourEarlier), RESET_AT)).toBe(true);
  });

  it('rejects a token minted one second before the reset', () => {
    expect(isTokenStale(seconds(RESET_AT) - 1, RESET_AT)).toBe(true);
  });

  it('accepts a token minted after the reset', () => {
    expect(isTokenStale(seconds(RESET_AT) + 1, RESET_AT)).toBe(false);
  });

  it('accepts a token minted in the same second as the reset', () => {
    // The fresh login right after resetting must not be signed straight out.
    expect(isTokenStale(seconds(RESET_AT), RESET_AT)).toBe(false);
  });

  it('accepts a token issued in the same second as a reset with millisecond drift', () => {
    const midSecondReset = new Date('2026-08-13T10:00:00.500Z');

    expect(isTokenStale(seconds(midSecondReset), midSecondReset)).toBe(false);
  });

  it('rejects a token carrying no issued-at claim', () => {
    expect(isTokenStale(undefined, RESET_AT)).toBe(true);
  });

  it('accepts a token with no issued-at claim when no reset has happened', () => {
    expect(isTokenStale(undefined, null)).toBe(false);
  });
});
