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

describe('parseClientMessage — three-stage messages', () => {
  it('parses set_ready with a boolean', () => {
    expect(parseClientMessage({ type: 'set_ready', ready: true })).toEqual({
      type: 'set_ready',
      ready: true,
    });
    expect(parseClientMessage({ type: 'set_ready', ready: 'yes' })).toBeNull();
  });

  it('parses start_prep', () => {
    expect(parseClientMessage({ type: 'start_prep' })).toEqual({ type: 'start_prep' });
  });

  it('parses submit_cards with a string array', () => {
    expect(
      parseClientMessage({ type: 'submit_cards', statements: ['a', 'b'] })
    ).toEqual({ type: 'submit_cards', statements: ['a', 'b'] });
    expect(parseClientMessage({ type: 'submit_cards', statements: 'a' })).toBeNull();
    expect(parseClientMessage({ type: 'submit_cards', statements: [1, 2] })).toBeNull();
  });
});
