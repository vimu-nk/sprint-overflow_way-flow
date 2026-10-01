import { useQuery } from '@tanstack/react-query';
import type { StoreHomeDto } from '@wayflow/shared';
import { get } from '@/lib/api';

export const useStoreHome = () => useQuery({ queryKey: ['store-orders', 'home'], queryFn: () => get<StoreHomeDto>('/store/home'), refetchInterval: 60_000 });

export const outletTitle = (o: { name: string; outletId: string }) => `${o.name} (${o.outletId})`;
