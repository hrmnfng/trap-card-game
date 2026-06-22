import { describe, it, expect } from 'vitest';
import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  isValidUsername,
} from './username.js';

describe('isValidUsername', () => {
  it('accepts a typical username', () => {
    expect(isValidUsername('alice')).toBe(true);
    expect(isValidUsername('Bob_99')).toBe(true);
  });

  it('rejects usernames that are too short or too long', () => {
    expect(isValidUsername('a'.repeat(USERNAME_MIN_LENGTH - 1))).toBe(false);
    expect(isValidUsername('a'.repeat(USERNAME_MAX_LENGTH + 1))).toBe(false);
  });

  it('accepts the boundary lengths', () => {
    expect(isValidUsername('a'.repeat(USERNAME_MIN_LENGTH))).toBe(true);
    expect(isValidUsername('a'.repeat(USERNAME_MAX_LENGTH))).toBe(true);
  });

  it('rejects disallowed characters', () => {
    expect(isValidUsername('bad name')).toBe(false);
    expect(isValidUsername('hi!')).toBe(false);
    expect(isValidUsername('drop;table')).toBe(false);
  });
});
