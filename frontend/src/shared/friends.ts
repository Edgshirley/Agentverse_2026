const FRIEND_IDS = ['edouard', 'jules', 'andre', 'michel', 'nathalie'];

/** Stand-in friends for flows that need someone else at the table. */
export function pickFriends(count: number, excludeIds: (string | null | undefined)[] = []): string[] {
  return FRIEND_IDS.filter((id) => !excludeIds.includes(id)).slice(0, count);
}
