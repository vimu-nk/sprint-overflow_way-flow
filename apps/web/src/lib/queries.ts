import { useQuery } from '@tanstack/react-query';
import type { ClockDto } from '@wayflow/shared';
import { get } from './api';

export const useClock = () => useQuery({ queryKey: ['clock'], queryFn: () => get<ClockDto>('/clock'), refetchInterval: 60_000 });
