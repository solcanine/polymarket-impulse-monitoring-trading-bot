import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { getMongoDB } from "@/lib/db";

type MetaId = "enabled" | "config" | "state";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const enabled = body.enabled === true || body.enabled === "true" || body.enabled === 1;

    const db = await getMongoDB();
    const filter: Filter<{ _id: MetaId }> = { _id: "enabled" };
    await db.collection<{ _id: MetaId }>("impulse_bot_meta").updateOne(
      filter,
      { $set: { enabled: enabled === true, updatedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, enabled: enabled === true });
  } catch (err) {
    console.error("[api/bot-toggle]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
