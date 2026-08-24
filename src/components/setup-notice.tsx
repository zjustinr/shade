import { isDatabaseConfigured } from "@/db";

/**
 * Shown only on a deployment with no database configured. The public shade
 * model is static and works regardless, but the field readings, the crew
 * tools and the Cooling Corners all need Postgres — better to say so
 * plainly than to look like a map that found nothing.
 */
export function SetupNotice() {
  if (isDatabaseConfigured()) return null;

  return (
    <aside className="border-b border-blue-300 bg-blue-50 px-4 py-2 text-sm text-blue-950">
      <p className="mx-auto max-w-5xl">
        <strong>Preview deployment.</strong> No database is connected, so there are no field
        readings or Cooling Corners yet and the crew tools cannot be opened. The modelled shade
        layer is static and works as shipped.
      </p>
    </aside>
  );
}
