CREATE TABLE "cooling_corners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text,
	"name_vi" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"description_en" text,
	"description_zh" text,
	"description_vi" text,
	"has_seating" boolean DEFAULT false,
	"installed_on" date,
	"photo_url" text
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" integer,
	"observer" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"gps_accuracy_m" real,
	"surface_type" text NOT NULL,
	"sun_temp_f" real NOT NULL,
	"shade_temp_f" real NOT NULL,
	"air_temp_f" real,
	"shade_source" text NOT NULL,
	"delta_f" real GENERATED ALWAYS AS ((sun_temp_f - shade_temp_f)) STORED,
	"photo_url" text,
	"notes" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_sun_temp_range" CHECK ("readings"."sun_temp_f" BETWEEN 20 AND 200),
	CONSTRAINT "readings_shade_temp_range" CHECK ("readings"."shade_temp_f" BETWEEN 20 AND 200)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text,
	"name_vi" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"site_type" text NOT NULL,
	"notes" text,
	"is_control" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "readings_site_idx" ON "readings" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "readings_time_idx" ON "readings" USING btree ("recorded_at");