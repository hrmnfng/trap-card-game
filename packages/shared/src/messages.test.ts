import { describe, it, expect } from 'vitest';
import { parseClientMessage } from './messages.js';

describe('parseClientMessage', () => {
  it('parses simple messages', () => {
    expect(parseClientMessage({ type: 'get_state' })).toEqual({ type: 'get_state' });
    expect(parseClientMessage({ type: 'start_game' })).toEqual({ type: 'start_game' });
    expect(parseClientMessage({ type: 'ping' })).toEqual({ type: 'ping' });
  });

  it('parses a valid play_card message', () => {
    expect(
      parseClientMessage({ type: 'play_card', cardId: 'c1', targetPlayerId: 'p2' })
    ).toEqual({ type: 'play_card', cardId: 'c1', targetPlayerId: 'p2' });
  });

  it('rejects play_card with missing fields', () => {
    expect(parseClientMessage({ type: 'play_card', cardId: 'c1' })).toBeNull();
    expect(parseClientMessage({ type: 'play_card' })).toBeNull();
  });

  it('rejects unknown / malformed payloads', () => {
    expect(parseClientMessage({ type: 'nope' })).toBeNull();
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage('string')).toBeNull();
    expect(parseClientMessage(42)).toBeNull();
  });
});
