import { describe, expect, it } from 'vitest';
import { timeAgo } from './format';

describe('timeAgo', () => {
  const now = new Date('2026-07-05T12:00:00Z');

  it('renders sub-minute as "now"', () => {
    expect(timeAgo('2026-07-05T11:59:30Z', now)).toBe('now');
  });

  it('renders minutes', () => {
    expect(timeAgo('2026-07-05T11:53:00Z', now)).toBe('7m');
  });

  it('renders hours', () => {
    expect(timeAgo('2026-07-05T09:00:00Z', now)).toBe('3h');
  });

  it('renders days', () => {
    expect(timeAgo('2026-07-02T12:00:00Z', now)).toBe('3d');
  });

  it('clamps future timestamps to "now"', () => {
    expect(timeAgo('2026-07-05T12:05:00Z', now)).toBe('now');
  });

  it('returns empty string for a malformed timestamp', () => {
    expect(timeAgo('not-a-date', now)).toBe('');
  });
});
