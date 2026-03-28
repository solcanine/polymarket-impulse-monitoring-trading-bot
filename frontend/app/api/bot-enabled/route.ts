import { NextResponse } from "next/server";
import { getMongoDB } from "@/lib/db";

export async function GET() {
  try {
    const db = await getMongoDB();
    const doc = await db.collection<{ _id: string; enabled?: boolean }>("impulse_bot_meta").findOne({ _id: "enabled" });
    const envDefault = process.env.ENABLE_IMPULSE_BOT !== "false";
    const enabled = doc ? doc.enabled === true : envDefault;
    return NextResponse.json({ enabled });
  } catch (err) {
    console.error("[api/bot-enabled]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
