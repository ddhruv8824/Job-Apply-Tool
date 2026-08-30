export function partitionDailyRuns<T extends { id: string; startedAt: Date }>(runs: T[], cutoff: Date): { staleIds: string[]; activeRunId?: string } {
  const staleIds = runs.filter((run) => run.startedAt < cutoff).map((run) => run.id);
  return { staleIds, activeRunId: runs.find((run) => !staleIds.includes(run.id))?.id };
}
