CREATE TYPE "public"."attachment_purpose" AS ENUM('pod', 'flag', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."brand" AS ENUM('Fresh', 'Style', 'Tech');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('served', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."deferral_class" AS ENUM('unavoidable', 'choice');--> statement-breakpoint
CREATE TYPE "public"."depot" AS ENUM('Peliyagoda', 'Kandy');--> statement-breakpoint
CREATE TYPE "public"."dock_type" AS ENUM('rear_dock', 'street', 'mall_bay');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('shortfall', 'damaged_load', 'vehicle_offline', 'receipt_issue', 'failed_delivery', 'road_problem', 'plan_changed', 'vehicle_workshop', 'sync_conflict', 'second_deferral');--> statement-breakpoint
CREATE TYPE "public"."failure_reason" AS ENUM('outlet_closed', 'access_refused', 'no_one_to_receive', 'wrong_address', 'goods_damaged', 'ran_out_of_time', 'other');--> statement-breakpoint
CREATE TYPE "public"."flag_kind" AS ENUM('shortfall', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('task2b_s1', 'synthetic_seed', 'store_manager');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'planned', 'published', 'loaded', 'departed', 'delivered', 'partial', 'failed', 'deferred', 'received', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."parking_constraint" AS ENUM('normal', 'van_only', 'mall_dock');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('generated', 'edited', 'published', 'replanned', 'closed');--> statement-breakpoint
CREATE TYPE "public"."problem_kind" AS ENUM('delay', 'breakdown', 'road_closure', 'access_refused', 'other');--> statement-breakpoint
CREATE TYPE "public"."reason_code" AS ENUM('NO_REEFER_CAPACITY', 'NO_VAN_CAPACITY', 'TIME_BUDGET', 'TRIP_LIMIT', 'FUEL_QUOTA', 'WINDOW_INFEASIBLE', 'VEHICLE_UNAVAILABLE', 'CAPACITY', 'PRIORITY_TRADEOFF', 'DISPATCHER_OVERRIDE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('dispatcher', 'loader', 'driver', 'store_manager');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."stop_status" AS ENUM('pending', 'arrived', 'delivered', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."temp_requirement" AS ENUM('ambient', 'chilled');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('planned', 'loading', 'ready', 'departed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."vehicle_day_status" AS ENUM('available', 'in_workshop');--> statement-breakpoint
CREATE TYPE "public"."vehicle_temp" AS ENUM('ambient', 'reefer');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('truck', 'van');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"purpose" "attachment_purpose" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"client_attachment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb,
	"ip" "inet",
	"user_agent" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"date" date PRIMARY KEY NOT NULL,
	"dow" smallint NOT NULL,
	"dow_name" text NOT NULL,
	"is_weekend" boolean NOT NULL,
	"iso_year" smallint NOT NULL,
	"iso_week" smallint NOT NULL,
	"is_payday" boolean NOT NULL,
	"festival" text,
	"festival_ramp" real NOT NULL,
	"is_holiday" boolean NOT NULL,
	"monsoon" boolean NOT NULL,
	"is_operating" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"plan_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"decision" "decision" NOT NULL,
	"reason_code" "reason_code",
	"deferral_class" "deferral_class",
	"explanation" text,
	"store_reason" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"second_consecutive" boolean DEFAULT false NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_plan_id_order_id_pk" PRIMARY KEY("plan_id","order_id"),
	CONSTRAINT "decisions_deferred_reason" CHECK ("decisions"."decision" = 'served' or "decisions"."reason_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "district_travel" (
	"district" text PRIMARY KEY NOT NULL,
	"depot" "depot" NOT NULL,
	"road_class" text NOT NULL,
	"free_flow_kmh" real NOT NULL,
	"depot_to_district_km" real NOT NULL,
	"depot_to_district_freeflow_min" real NOT NULL,
	"inter_stop_km" real NOT NULL,
	"inter_stop_freeflow_min" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "exception_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"run_date" date NOT NULL,
	"vehicle_id" text,
	"trip_id" uuid,
	"order_id" uuid,
	"outlet_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"raised_by" uuid,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "load_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"kind" "flag_kind" NOT NULL,
	"units_affected" integer NOT NULL,
	"note" text,
	"after_departure" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at_client" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"outlet_id" text NOT NULL,
	"brand" "brand" NOT NULL,
	"temp" "temp_requirement" NOT NULL,
	"units" integer NOT NULL,
	"weight_kg" real NOT NULL,
	"volume_m3" real NOT NULL,
	"run_date" date NOT NULL,
	"status" "order_status" NOT NULL,
	"source" "order_source" NOT NULL,
	"placed_by" uuid,
	"deferred_yesterday" boolean DEFAULT false NOT NULL,
	"days_since_last_served" smallint DEFAULT 1 NOT NULL,
	"carried_from_id" uuid,
	"delivered_units" integer,
	"placed_after_cutoff" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_positive" CHECK ("orders"."units" > 0 and "orders"."weight_kg" > 0 and "orders"."volume_m3" > 0)
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"outlet_id" text PRIMARY KEY NOT NULL,
	"brand" "brand" NOT NULL,
	"district" text NOT NULL,
	"depot" "depot" NOT NULL,
	"dock_type" "dock_type" NOT NULL,
	"parking_constraint" "parking_constraint" NOT NULL,
	"mall_open_min" smallint,
	"mall_close_min" smallint,
	"window_open_min" smallint NOT NULL,
	"window_close_min" smallint NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"diff" jsonb,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_versions_plan_id_version_pk" PRIMARY KEY("plan_id","version")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"depot" "depot" NOT NULL,
	"status" "plan_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_version" integer,
	"summary" jsonb,
	"engine" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "problem_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "problem_kind" NOT NULL,
	"delay_min" smallint,
	"note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at_client" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"units_received" integer NOT NULL,
	"damaged_units" integer DEFAULT 0 NOT NULL,
	"problem" boolean NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid
);
--> statement-breakpoint
CREATE TABLE "road_conditions" (
	"district" text NOT NULL,
	"date" date NOT NULL,
	"disruption_index" real NOT NULL,
	CONSTRAINT "road_conditions_district_date_pk" PRIMARY KEY("district","date")
);
--> statement-breakpoint
CREATE TABLE "service_allowances" (
	"brand" "brand" NOT NULL,
	"dock_type" "dock_type" NOT NULL,
	"service_allowance_min" real NOT NULL,
	CONSTRAINT "service_allowances_brand_dock_type_pk" PRIMARY KEY("brand","dock_type")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"planned_arrival_min" smallint NOT NULL,
	"service_min" real NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"status" "stop_status" DEFAULT 'pending' NOT NULL,
	"loaded" boolean DEFAULT false NOT NULL,
	"loaded_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_at_client" timestamp with time zone,
	"delivered_units" integer,
	"failure_reason" "failure_reason",
	"short_note" text,
	"recipient_name" text,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"needs_review" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_action_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at_client" timestamp with time zone NOT NULL,
	"clock_skew_flag" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_speeds" (
	"district" text NOT NULL,
	"hour" smallint NOT NULL,
	"monsoon" boolean NOT NULL,
	"speed_index" real NOT NULL,
	CONSTRAINT "traffic_speeds_district_hour_monsoon_pk" PRIMARY KEY("district","hour","monsoon")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_no" smallint NOT NULL,
	"brand" "brand" NOT NULL,
	"district" text NOT NULL,
	"status" "trip_status" DEFAULT 'planned' NOT NULL,
	"depart_min" smallint NOT NULL,
	"return_min" smallint NOT NULL,
	"metrics" jsonb NOT NULL,
	"loading_started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_signal_at" timestamp with time zone,
	"reported_delay_min" smallint DEFAULT 0 NOT NULL,
	"seen_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_trip_no" CHECK ("trips"."trip_no" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "unit_profiles" (
	"brand" "brand" NOT NULL,
	"temp" "temp_requirement" NOT NULL,
	"kg_per_unit" real NOT NULL,
	"m3_per_unit" real NOT NULL,
	"sample_size" integer NOT NULL,
	CONSTRAINT "unit_profiles_brand_temp_pk" PRIMARY KEY("brand","temp")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	"depot" "depot",
	"outlet_id" text,
	"vehicle_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sessions_valid_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_scope" CHECK (("users"."role" <> 'store_manager' or "users"."outlet_id" is not null) and ("users"."role" <> 'loader' or "users"."depot" is not null) and ("users"."role" <> 'driver' or "users"."vehicle_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "vehicle_days" (
	"vehicle_id" text NOT NULL,
	"date" date NOT NULL,
	"status" "vehicle_day_status" NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_days_vehicle_id_date_pk" PRIMARY KEY("vehicle_id","date")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"vehicle_id" text PRIMARY KEY NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"temp" "vehicle_temp" NOT NULL,
	"weight_cap_kg" real NOT NULL,
	"volume_cap_m3" real NOT NULL,
	"fuel_type" text NOT NULL,
	"km_per_l" real NOT NULL,
	"weekly_fuel_quota_l" real NOT NULL,
	"depot" "depot" NOT NULL,
	CONSTRAINT "vehicle_caps_positive" CHECK ("vehicles"."weight_cap_kg" > 0 and "vehicles"."volume_cap_m3" > 0 and "vehicles"."km_per_l" > 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_vehicle_id_vehicles_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("vehicle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_outlet_id_outlets_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_flags" ADD CONSTRAINT "load_flags_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_flags" ADD CONSTRAINT "load_flags_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_flags" ADD CONSTRAINT "load_flags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_actions" ADD CONSTRAINT "sync_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("vehicle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_district_district_travel_district_fk" FOREIGN KEY ("district") REFERENCES "public"."district_travel"("district") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_outlet_id_outlets_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_vehicle_id_vehicles_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("vehicle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_days" ADD CONSTRAINT "vehicle_days_vehicle_id_vehicles_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("vehicle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_days" ADD CONSTRAINT "vehicle_days_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_client_uq" ON "attachments" USING btree ("uploaded_by","client_attachment_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "exceptions_code_uq" ON "exceptions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "exceptions_run_idx" ON "exceptions" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_ref_uq" ON "orders" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "orders_run_status_idx" ON "orders" USING btree ("run_date","status");--> statement-breakpoint
CREATE INDEX "orders_outlet_idx" ON "orders" USING btree ("outlet_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_run_depot_uq" ON "plans" USING btree ("run_date","depot");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "stops_trip_seq_idx" ON "stops" USING btree ("trip_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "stops_order_live_uq" ON "stops" USING btree ("order_id") WHERE "stops"."status" <> 'skipped';--> statement-breakpoint
CREATE UNIQUE INDEX "sync_actions_user_client_uq" ON "sync_actions" USING btree ("user_id","client_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_vehicle_day_uq" ON "trips" USING btree ("run_date","vehicle_id","trip_no") WHERE "trips"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "trips_plan_idx" ON "trips" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "trips_date_vehicle_idx" ON "trips" USING btree ("run_date","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");