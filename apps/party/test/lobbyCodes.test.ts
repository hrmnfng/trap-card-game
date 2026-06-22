import { describe, it, expect } from 'vitest';
import { pickUnusedCode } from '../src/lobbyCodes.js';

describe('pickUnusedCode', () => {
  it('returns the first code that reserves successfully', async () => {
    const code = await pickUnusedCode(
      async () => true, // reserve always succeeds
      () => 'AAAA'
    );
    expect(code).toBe('AAAA');
  });

  it('retries past taken codes until one reserves', async () => {
    const generated = ['AAAA', 'BBBB', 'CCCC'];
    let i = 0;
    const code = await pickUnusedCode(
      async (c) => c === 'CCCC', // only the third reserves
      () => generated[i++]!
    );
    expect(code).toBe('CCCC');
  });

  it('throws after exhausting maxTries', async () => {
    await expect(
      pickUnusedCode(async () => false, () => 'AAAA', 3)
    ).rejects.toThrow(/unique lobby code/i);
  });
});
