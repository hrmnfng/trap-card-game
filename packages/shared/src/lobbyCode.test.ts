import { describe, it, expect } from 'vitest';
import {
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  generateLobbyCode,
  normalizeLobbyCode,
} from './lobbyCode.js';

describe('generateLobbyCode', () => {
  it('produces a code of the configured length', () => {
    expect(generateLobbyCode()).toHaveLength(LOBBY_CODE_LENGTH);
  });

  it('uses only alphabet characters, never I/L/O/U', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLobbyCode();
      for (const ch of code) {
        expect(LOBBY_CODE_ALPHABET).toContain(ch);
      }
      expect(code).not.toMatch(/[ILOU]/);
    }
  });
});

describe('normalizeLobbyCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeLobbyCode('  ab1d ')).toBe('AB1D');
  });

  it('maps confusable characters on 4-char codes (I/L -> 1, O -> 0)', () => {
    expect(normalizeLobbyCode('oilz')).toBe('011Z'); // O->0, I->1, L->1, Z stays (Z is a valid Crockford char)
    expect(normalizeLobbyCode('I00L')).toBe('1001');
  });

  it('leaves legacy 6-char codes untouched beyond trim/uppercase', () => {
    expect(normalizeLobbyCode('hello1')).toBe('HELLO1');
    expect(normalizeLobbyCode(' room0a ')).toBe('ROOM0A');
  });

  it('leaves a clean 4-char code unchanged', () => {
    expect(normalizeLobbyCode('AB12')).toBe('AB12');
  });
});
