import { NextResponse } from "next/server";
import { getMongoDB } from "@/lib/db";

type BotStateDoc = {
  _id: string;
  upPrice?: number;
  downPrice?: number;
  upTokenId?: string;
  downTokenId?: string;
  conditionId?: string;
  position?: unknown;
  currentSlug?: string;
  marketStartTime?: number;
  marketEndTime?: number;
  walletBalanceUsd?: number;
  positionValueUsd?: number;
};

async function loadPriceSeries(
  db: Awaited<ReturnType<typeof getMongoDB>>,
  tokenId: string,
  lookbackSec: number
): Promise<{ ts: number; price: number }[]> {
  const cutoff = Date.now() / 1000 - lookbackSec;
  const rows = await db
    .collection<{ ts: number; price: number }>("impulse_bot_prices")
    .find({ tokenId, ts: { $gte: cutoff } }, { projection: { _id: 0, ts: 1, price: 1 } })
    .sort({ ts: 1 })
    .toArray();
  return rows.map((r) => ({ ts: r.ts, price: r.price }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get("includeHistory") === "1";

    const db = await getMongoDB();
    const stateDoc = await db.collection<BotStateDoc>("impulse_bot_meta").findOne({ _id: "state" });

    if (!stateDoc) {
      return NextResponse.json({
        upPrice: null,
        downPrice: null,
        position: null,
        conditionId: null,
        upTokenId: null,
        downTokenId: null,
        marketStartTime: null,
        marketEndTime: null,
        priceHistory: null,
        impulseEvents: [],
        walletBalanceUsd: null,
        positionValueUsd: null,
      });
    }

    const state = {
      upPrice: stateDoc.upPrice,
      downPrice: stateDoc.downPrice,
      upTokenId: stateDoc.upTokenId,
      downTokenId: stateDoc.downTokenId,
      conditionId: stateDoc.conditionId,
      position: stateDoc.position,
      currentSlug: stateDoc.currentSlug,
      marketStartTime: stateDoc.marketStartTime,
      marketEndTime: stateDoc.marketEndTime,
    };

    let priceHistory: { up: { ts: number; price: number }[]; down: { ts: number; price: number }[] } | null = null;
    let impulseEvents: { ts: number; price: number; side: string; time: string }[] = [];

    const configDoc = await db
      .collection<{ _id: string; config?: { limitPrice?: number; minJump?: number; lookbackSec?: number } }>(
        "impulse_bot_meta"
      )
      .findOne({ _id: "config" });
    const lookbackSec = configDoc?.config?.lookbackSec ?? 60;

    if (includeHistory && state.upTokenId && state.downTokenId) {
      const [up, down] = await Promise.all([
        loadPriceSeries(db, state.upTokenId, lookbackSec),
        loadPriceSeries(db, state.downTokenId, lookbackSec),
      ]);
      priceHistory = { up, down };
    }

    if (state.conditionId) {
      const buys = await db
        .collection("impulse_buys")
        .find({ conditionId: state.conditionId })
        .sort({ boughtAt: 1 })
        .toArray();
      impulseEvents = (buys as unknown as Array<{ boughtAt: number; price: number; side: string }>).map((b) => ({
        ts: b.boughtAt,
        price: b.price,
        side: b.side,
        time: new Date(b.boughtAt * 1000).toLocaleTimeString(),
      }));
    }

    if (priceHistory && priceHistory.up.length > 0 && priceHistory.down.length > 0) {
      const config = configDoc?.config ?? {};
      const limitPrice = config.limitPrice ?? 0.55;
      const minJump = config.minJump ?? 0.05;

      const buyTsSet = new Set(impulseEvents.map((e) => e.ts));

      const JUMP_LOOKBACK_SEC = 2;

      const detectImpulses = (history: { ts: number; price: number }[], side: string) => {
        const satisfies = (idx: number): boolean => {
          const p = history[idx];
          const targetTs = p.ts - JUMP_LOOKBACK_SEC;
          const beforePoints = history.filter((h) => h.ts <= targetTs);
          if (beforePoints.length === 0) return false;
          const prev = beforePoints.reduce((a, b) => (a.ts > b.ts ? a : b));
          const jump = p.price - prev.price;
          return p.price >= limitPrice && jump >= minJump;
        };

        const out: { ts: number; price: number; side: string; time: string }[] = [];
        for (let i = 0; i < history.length; i++) {
          const p = history[i];
          const prevSatisfied = i > 0 && satisfies(i - 1);
          if (!satisfies(i)) continue;
          if (prevSatisfied) continue;

          const nearExisting = [...buyTsSet].some((t) => Math.abs(t - p.ts) <= 3);
          if (!nearExisting) {
            buyTsSet.add(p.ts);
            out.push({ ts: p.ts, price: p.price, side, time: new Date(p.ts * 1000).toLocaleTimeString() });
          }
        }
        return out;
      };

      const upImpulses = detectImpulses(priceHistory.up, "Up");
      const downImpulses = detectImpulses(priceHistory.down, "Down");
      impulseEvents = [...impulseEvents, ...upImpulses, ...downImpulses].sort((a, b) => a.ts - b.ts);
    }

    const walletBalanceUsd =
      stateDoc?.walletBalanceUsd != null && Number.isFinite(stateDoc.walletBalanceUsd)
        ? stateDoc.walletBalanceUsd
        : null;
    const positionValueUsd =
      stateDoc?.positionValueUsd != null && Number.isFinite(stateDoc.positionValueUsd)
        ? stateDoc.positionValueUsd
        : null;

    return NextResponse.json({
      upPrice: state.upPrice ?? null,
      downPrice: state.downPrice ?? null,
      position: state.position ?? null,
      conditionId: state.conditionId ?? null,
      upTokenId: state.upTokenId ?? null,
      downTokenId: state.downTokenId ?? null,
      currentSlug: state.currentSlug ?? null,
      marketStartTime: state.marketStartTime ?? null,
      marketEndTime: state.marketEndTime ?? null,
      priceHistory,
      impulseEvents,
      walletBalanceUsd,
      positionValueUsd,
    });
  } catch (err) {
    console.error("[api/impulse-state]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
