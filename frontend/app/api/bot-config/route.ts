import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { getMongoDB } from "@/lib/db";

type MetaId = "enabled" | "config" | "state";

export async function GET() {
  try {
    const db = await getMongoDB();
    const doc = await db
      .collection<{ _id: string; config?: Record<string, unknown> }>("impulse_bot_meta")
      .findOne({ _id: "config" });
    if (!doc?.config) {
      return NextResponse.json({
        config: null,
        message: "No config in MongoDB, using env defaults",
      });
    }
    return NextResponse.json({ config: doc.config });
  } catch (err) {
    console.error("[api/bot-config GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const config = {
      slugPrefix: String(body.slugPrefix ?? body.slug ?? ""),
      windowSeconds: parseInt(body.windowSeconds, 10) || 900,
      limitPrice: parseFloat(body.limitPrice) || 0.55,
      minJump: parseFloat(body.minJump) || 0.05,
      lookbackSec: parseInt(body.lookbackSec, 10) || 60,
      trailingStopPct: parseFloat(body.trailingStopPct) || 5,
      buyAmountUsd: parseFloat(body.buyAmountUsd) || 10,
      pollIntervalMs: parseInt(body.pollIntervalMs, 10) || 2000,
    };

    const db = await getMongoDB();
    const filter: Filter<{ _id: MetaId }> = { _id: "config" };
    await db.collection<{ _id: MetaId }>("impulse_bot_meta").updateOne(
      filter,
      { $set: { config, updatedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("[api/bot-config POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
