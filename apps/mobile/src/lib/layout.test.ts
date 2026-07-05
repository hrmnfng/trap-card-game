import { describe, expect, it } from 'vitest';
import { headerClearance } from './layout';

/**
 * The transparent-header clearance contract. On Android, native-stack's
 * measured header height is unreliable when `headerTransparent: true` — it can
 * report 0 or just the status-bar inset — so the clearance must never fall
 * below the platform default header height. On web the measurement works and
 * equals the default, so the result must be exactly the measurement (no
 * layout change where things already render correctly).
 */
describe('headerClearance', () => {
  it('falls back to the platform default when the measurement is 0 (Android transparent-header bug)', () => {
    // Android: status bar 24 + toolbar 56 = 80 default; measurement lost.
    expect(headerClearance(0, 80)).toBe(80);
  });

  it('falls back when the measurement only reports the status-bar inset', () => {
    expect(headerClearance(24, 80)).toBe(80);
  });

  it('returns the measurement when it matches the default (web: 64/64)', () => {
    expect(headerClearance(64, 64)).toBe(64);
  });

  it('trusts a measurement larger than the default (e.g. large titles)', () => {
    expect(headerClearance(96, 64)).toBe(96);
  });
});
