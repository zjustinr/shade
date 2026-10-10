ALTER TABLE "readings" ADD COLUMN "wind_mph" real;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "wind_gust_mph" real;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "wind_from" text;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_wind_range" CHECK ("readings"."wind_mph" IS NULL OR "readings"."wind_mph" BETWEEN 0 AND 120);--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_wind_gust_range" CHECK ("readings"."wind_gust_mph" IS NULL OR "readings"."wind_gust_mph" BETWEEN 0 AND 150);