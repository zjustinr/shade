import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { requireCrewAuth } from "@/lib/require-auth";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — phone camera JPEGs, generous headroom

export async function POST(request: NextRequest) {
  const unauthorized = await requireCrewAuth();
  if (unauthorized) return unauthorized;

  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing photo file." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Photo too large." }, { status: 413 });
  }

  const key = `readings/${crypto.randomUUID()}-${file.name || "photo.jpg"}`;
  const blob = await put(key, file, {
    access: "public",
    addRandomSuffix: false,
  });

  return NextResponse.json({ url: blob.url });
}
