import { describe, it, expect } from 'vitest';
import { screenForState } from './navigation';

describe('screenForState', () => {
  it('maps waiting -> lobby', () => {
    expect(screenForState('waiting', false)).toBe('lobby');
  });
  it('maps prep -> prep', () => {
    expect(screenForState('prep', false)).toBe('prep');
  });
  it('keeps an un-submitted in-progress player in prep', () => {
    expect(screenForState('in-progress', false)).toBe('prep');
  });
  it('sends a submitted in-progress player to the game', () => {
    expect(screenForState('in-progress', true)).toBe('game');
  });
  it('maps concluded -> game (regardless of submission)', () => {
    expect(screenForState('concluded', true)).toBe('game');
    expect(screenForState('concluded', false)).toBe('game');
  });
});
