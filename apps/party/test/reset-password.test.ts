import { describe, it, expect } from 'vitest';
import { parseResetArgs, buildUpdateSql } from '../scripts/reset-password.lib.js';

describe('parseResetArgs', () => {
  it('parses username + password and defaults to local', () => {
    expect(parseResetArgs(['Alice', 'secret'])).toEqual({
      username: 'Alice',
      usernameLc: 'alice',
      newPassword: 'secret',
      remote: false,
    });
  });

  it('detects --remote in any position', () => {
    expect(parseResetArgs(['--remote', 'Bob', 'pw']).remote).toBe(true);
    expect(parseResetArgs(['Bob', 'pw', '--remote']).remote).toBe(true);
  });

  it('throws on missing args', () => {
    expect(() => parseResetArgs(['onlyuser'])).toThrow();
  });

  it('throws on an invalid username', () => {
    expect(() => parseResetArgs(['bad name', 'pw'])).toThrow();
  });

  it('throws on an empty password', () => {
    expect(() => parseResetArgs(['alice', ''])).toThrow();
  });
});

describe('buildUpdateSql', () => {
  it('builds an UPDATE keyed on username_lc', () => {
    expect(buildUpdateSql('alice', 'pbkdf2$100000$c2FsdA==$aGFzaA==')).toBe(
      "UPDATE users SET password_hash = 'pbkdf2$100000$c2FsdA==$aGFzaA==' WHERE username_lc = 'alice';"
    );
  });
});
