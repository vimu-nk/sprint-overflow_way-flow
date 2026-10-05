import { useClock } from '@/lib/queries';

/** The run the dispatcher works on: ?date= or the next operating run from the simulation clock. */
export function useRunDate(searchDate?: string): string | undefined {
  const clock = useClock();
  return searchDate ?? clock.data?.planningRunDate;
}

export const dateSearch = (s: Record<string, unknown>): { date?: string } => ({
  date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
});
