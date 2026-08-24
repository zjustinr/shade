import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, readings } from "@/db";
import { flagUpdateSchema } from "@/lib/validation";
import { requireAdminAuth } from "@/lib/require-auth";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/readings/[id]">,
) {
  const unauthorized = await requireAdminAuth();
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = flagUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(readings)
    .set({
      flagged: parsed.data.flagged,
      flagReason: parsed.data.flagged ? (parsed.data.flagReason ?? "manual") : null,
    })
    .where(eq(readings.id, id))
    .returning({ id: readings.id, flagged: readings.flagged, flagReason: readings.flagReason });

  if (!updated) {
    return NextResponse.json({ error: "Reading not found." }, { status: 404 });
  }

  return NextResponse.json(updated);
}
