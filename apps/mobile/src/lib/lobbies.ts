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
