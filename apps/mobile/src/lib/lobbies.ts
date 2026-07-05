import type { LobbyHistoryItem } from '@trap/shared';

export interface GroupedLobbies {
  active: LobbyHistoryItem[];
  completed: LobbyHistoryItem[];
}

/**
 * Partition lobby-history items into Active (still joinable: waiting/prep/
 * in-progress) and Completed (concluded). Input order is preserved within each
 * group, so the server's recency ordering carries through.
 */
export function groupLobbiesByState(items: LobbyHistoryItem[]): GroupedLobbies {
  const active: LobbyHistoryItem[] = [];
  const completed: LobbyHistoryItem[] = [];
  for (const lobby of items) {
    if (lobby.status === 'concluded') completed.push(lobby);
    else active.push(lobby);
  }
  return { active, completed };
}

export type LobbySortMode = 'recent' | 'oldest' | 'code';

export const LOBBY_SORT_LABELS: Record<LobbySortMode, string> = {
  recent: 'Recent',
  oldest: 'Oldest',
  code: 'A–Z',
};

/** Order the sort toggle cycles through. */
export const LOBBY_SORT_CYCLE: readonly LobbySortMode[] = ['recent', 'oldest', 'code'];

/**
 * Sort lobby-history items for display. `recent`/`oldest` order by `joinedAt`
 * (the server's own recency column — `lobby_history` has no last-activity
 * column, so "recent" means "most recently joined"); `code` is alphabetical.
 * Returns a new array; missing timestamps sort as oldest.
 */
export function sortLobbies(
  items: LobbyHistoryItem[],
  mode: LobbySortMode
): LobbyHistoryItem[] {
  const copy = [...items];
  switch (mode) {
    case 'recent':
      return copy.sort((a, b) => (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''));
    case 'oldest':
      return copy.sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? ''));
    case 'code':
      return copy.sort((a, b) => a.code.localeCompare(b.code));
  }
}
