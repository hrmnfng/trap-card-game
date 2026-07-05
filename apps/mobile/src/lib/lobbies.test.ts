import { describe, it, expect } from 'vitest';
import {
  groupLobbiesByState,
  sortLobbies,
  LOBBY_SORT_CYCLE,
  type LobbySortMode,
} from './lobbies';
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

const itemAt = (code: string, joinedAt: string): LobbyHistoryItem => ({
  id: `id-${code}`,
  code,
  status: 'waiting',
  ownerId: null,
  ownerUsername: null,
  createdAt: joinedAt,
  joinedAt,
  playerCount: 1,
});

describe('sortLobbies', () => {
  const items = [
    itemAt('BBBB', '2026-07-02T10:00:00Z'),
    itemAt('AAAA', '2026-07-04T10:00:00Z'),
    itemAt('CCCC', '2026-07-03T10:00:00Z'),
  ];

  it('recent puts the newest joinedAt first', () => {
    expect(sortLobbies(items, 'recent').map((i) => i.code)).toEqual([
      'AAAA',
      'CCCC',
      'BBBB',
    ]);
  });

  it('oldest puts the earliest joinedAt first', () => {
    expect(sortLobbies(items, 'oldest').map((i) => i.code)).toEqual([
      'BBBB',
      'CCCC',
      'AAAA',
    ]);
  });

  it('code sorts alphabetically', () => {
    expect(sortLobbies(items, 'code').map((i) => i.code)).toEqual([
      'AAAA',
      'BBBB',
      'CCCC',
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...items];
    sortLobbies(items, 'recent');
    expect(items).toEqual(copy);
  });

  it('sorts a missing joinedAt as oldest', () => {
    const withMissing = [...items, { ...itemAt('DDDD', ''), joinedAt: '' }];
    expect(sortLobbies(withMissing, 'recent').at(-1)!.code).toBe('DDDD');
  });

  it('cycle covers every mode exactly once', () => {
    expect([...LOBBY_SORT_CYCLE].sort()).toEqual(
      (['code', 'oldest', 'recent'] as LobbySortMode[]).sort()
    );
  });
});
