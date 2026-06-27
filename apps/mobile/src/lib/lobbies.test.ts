import { describe, it, expect } from 'vitest';
import { groupLobbiesByState } from './lobbies';
import type { LobbyHistoryItem } from '@trap/shared';

const item = (code: string, status: LobbyHistoryItem['status']): LobbyHistoryItem => ({
  id: `id-${code}`,
  code,
  status,
  ownerId: 'u1',
  ownerUsername: 'alice',
  createdAt: '2026-06-27T00:00:00.000Z',
  joinedAt: '2026-06-27T00:00:00.000Z',
  playerCount: 2,
});

describe('groupLobbiesByState', () => {
  it('puts waiting/prep/in-progress under active and concluded under completed', () => {
    const { active, completed } = groupLobbiesByState([
      item('AAAA', 'waiting'),
      item('BBBB', 'concluded'),
      item('CCCC', 'in-progress'),
      item('DDDD', 'prep'),
      item('EEEE', 'concluded'),
    ]);
    expect(active.map((l) => l.code)).toEqual(['AAAA', 'CCCC', 'DDDD']);
    expect(completed.map((l) => l.code)).toEqual(['BBBB', 'EEEE']);
  });

  it('returns empty groups for an empty list', () => {
    expect(groupLobbiesByState([])).toEqual({ active: [], completed: [] });
  });
});
