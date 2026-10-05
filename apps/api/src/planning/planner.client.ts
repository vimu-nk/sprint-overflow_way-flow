import { Injectable, Logger } from '@nestjs/common';
import { env } from '../env.js';

export interface PlannerRequest {
  date: string;
  depot: string;
  orders: {
    ref: string;
    brand: string;
    district: string;
    chilled: boolean;
    van_only: boolean;
    weight_kg: number;
    volume_m3: number;
    service_min: number;
    priority: number;
  }[];
  vehicles: {
    vehicle_id: string;
    is_van: boolean;
    is_reefer: boolean;
    weight_cap_kg: number;
    volume_cap_m3: number;
    km_per_l: number;
    fuel_remaining_l: number;
  }[];
  travel: Record<string, { outbound_min: number; inter_stop_min: number; outbound_km: number; inter_stop_km: number }>;
  pins: { ref: string; vehicle_id: string; trip_no: number }[];
  preferences: { ref: string; vehicle_id: string; trip_no: number }[];
  deterministic_time?: number;
}

export interface PlannerResponse {
  trips: { vehicle_id: string; trip_no: number; brand: string; district: string; order_refs: string[] }[];
  unassigned: string[];
  status: string;
  objective: number;
  solve_ms: number;
}

/** HTTP client for the internal OR-Tools planner (never exposed through the gateway). */
@Injectable()
export class PlannerClient {
  private readonly log = new Logger('Planner');

  async plan(req: PlannerRequest): Promise<PlannerResponse> {
    const res = await fetch(`${env.PLANNER_URL}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.warn({ status: res.status, body: text.slice(0, 300) }, 'planner error');
      throw new Error(`Planner responded ${res.status}`);
    }
    return (await res.json()) as PlannerResponse;
  }
}
