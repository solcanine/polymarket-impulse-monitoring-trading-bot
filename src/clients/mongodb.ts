import { MongoClient, Db } from "mongodb";
import { tradingEnv } from "../config/env";
import type { ImpulseBuyDoc, ImpulseConfig, ImpulsePosition, RedeemRecordDoc } from "../types";

type BotEnabledDoc = { _id: "enabled"; enabled: boolean; updatedAt: Date };
type BotConfigDoc = { _id: "config"; config: ImpulseConfig; updatedAt: Date };
type BotStateDoc = {
  _id: "state";
  updatedAt: Date;
  upPrice?: number;
  downPrice?: number;
  upTokenId?: string;
  downTokenId?: string;
  conditionId?: string;
  position?: ImpulsePosition | null;
  currentSlug?: string;
  slugPrefix?: string;
  marketStartTime?: number;
  marketEndTime?: number;
  walletBalanceUsd?: number;
  positionValueUsd?: number;
};

type BotPositionDoc = { _id: string; position: ImpulsePosition; updatedAt: Date };
type BotPricePointDoc = {
  tokenId: string;
  ts: number;
  price: number;
  createdAt: Date;
};

export class MongoDBClient {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(): Promise<void> {
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
    const dbName = process.env.MONGODB_DB || "polymarket_impulse";

    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(dbName);

    await this.db.collection("impulse_buys").createIndex({ conditionId: 1 });
    await this.db.collection("impulse_buys").createIndex({ boughtAt: -1 });
    await this.db.collection("impulse_buys").createIndex({ conditionId: 1, side: 1 });
    await this.db.collection("redeem_history").createIndex({ redeemedAt: -1 });
    await this.db.collection("redeem_history").createIndex({ conditionId: 1 });

    await this.db.collection<BotPositionDoc>("impulse_bot_positions").createIndex({ updatedAt: -1 });

    await this.db.collection<BotPricePointDoc>("impulse_bot_prices").createIndex({ tokenId: 1, ts: 1 });
    await this.db
      .collection<BotPricePointDoc>("impulse_bot_prices")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 48 });
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.close();
    this.client = null;
    this.db = null;
  }

  async saveImpulseBuy(doc: ImpulseBuyDoc): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    await this.db.collection<ImpulseBuyDoc>("impulse_buys").insertOne(doc);
  }

  async hasBoughtToken(conditionId: string, side: "Up" | "Down"): Promise<boolean> {
    if (!this.db) return false;
    const doc = await this.db
      .collection<ImpulseBuyDoc>("impulse_buys")
      .findOne({ conditionId, side });
    return doc != null;
  }

  async getImpulseBuys(filter?: { conditionId?: string }, limit = 100): Promise<ImpulseBuyDoc[]> {
    if (!this.db) return [];
    const query: Record<string, unknown> = {};
    if (filter?.conditionId) query.conditionId = filter.conditionId;
    return this.db
      .collection<ImpulseBuyDoc>("impulse_buys")
      .find(query)
      .sort({ boughtAt: -1 })
      .limit(limit)
      .toArray();
  }

  async saveRedeemRecord(doc: RedeemRecordDoc): Promise<void> {
    if (!this.db) throw new Error("MongoDB not connected");
    await this.db.collection<RedeemRecordDoc>("redeem_history").insertOne(doc);
  }

  async getEventSlugByConditionId(conditionId: string): Promise<string | null> {
    if (!this.db) return null;
    const doc = await this.db
      .collection<ImpulseBuyDoc>("impulse_buys")
      .findOne({ conditionId }, { projection: { eventSlug: 1 } });
    return doc?.eventSlug ?? null;
  }

  private assertDb(): Db {
    if (!this.db) throw new Error("MongoDB not connected");
    return this.db;
  }

  async getEnabled(): Promise<boolean> {
    const db = this.assertDb();
    const doc = await db.collection<BotEnabledDoc>("impulse_bot_meta").findOne({ _id: "enabled" });
    if (!doc) return tradingEnv.ENABLE_IMPULSE_BOT;
    return doc.enabled === true;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const db = this.assertDb();
    await db.collection<BotEnabledDoc>("impulse_bot_meta").updateOne(
      { _id: "enabled" },
      { $set: { enabled: enabled === true, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async getConfig(): Promise<ImpulseConfig | null> {
    const db = this.assertDb();
    const doc = await db.collection<BotConfigDoc>("impulse_bot_meta").findOne({ _id: "config" });
    return doc?.config ?? null;
  }

  async setConfig(config: ImpulseConfig): Promise<void> {
    const db = this.assertDb();
    await db.collection<BotConfigDoc>("impulse_bot_meta").updateOne(
      { _id: "config" },
      { $set: { config, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async getImpulseState(): Promise<Omit<BotStateDoc, "_id"> | null> {
    const db = this.assertDb();
    const doc = await db.collection<BotStateDoc>("impulse_bot_meta").findOne({ _id: "state" });
    if (!doc) return null;
    const { _id: _stateId, ...rest } = doc;
    void _stateId;
    return rest;
  }

  async setImpulseState(data: Omit<BotStateDoc, "_id" | "updatedAt">): Promise<void> {
    const db = this.assertDb();
    await db.collection<BotStateDoc>("impulse_bot_meta").updateOne(
      { _id: "state" },
      { $set: { ...data, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async patchImpulseState(patch: Partial<Omit<BotStateDoc, "_id">>): Promise<void> {
    const db = this.assertDb();
    await db.collection<BotStateDoc>("impulse_bot_meta").updateOne(
      { _id: "state" },
      { $set: { ...patch, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async getPosition(conditionId: string): Promise<ImpulsePosition | null> {
    const db = this.assertDb();
    const doc = await db.collection<BotPositionDoc>("impulse_bot_positions").findOne({ _id: conditionId });
    return doc?.position ?? null;
  }

  async setPosition(conditionId: string, position: ImpulsePosition | null): Promise<void> {
    const db = this.assertDb();
    if (!position) {
      await db.collection<BotPositionDoc>("impulse_bot_positions").deleteOne({ _id: conditionId });
      return;
    }
    await db.collection<BotPositionDoc>("impulse_bot_positions").updateOne(
      { _id: conditionId },
      { $set: { position, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async appendPricePoint(tokenId: string, ts: number, price: number): Promise<void> {
    const db = this.assertDb();
    await db.collection<BotPricePointDoc>("impulse_bot_prices").insertOne({
      tokenId,
      ts,
      price,
      createdAt: new Date(),
    });
  }

  async getPriceHistory(tokenId: string, lookbackSec: number): Promise<{ ts: number; price: number }[]> {
    const db = this.assertDb();
    const cutoff = Date.now() / 1000 - lookbackSec;
    const rows = await db
      .collection<BotPricePointDoc>("impulse_bot_prices")
      .find({ tokenId, ts: { $gte: cutoff } }, { projection: { _id: 0, ts: 1, price: 1 } })
      .sort({ ts: 1 })
      .toArray();
    return rows.map((r) => ({ ts: r.ts, price: r.price }));
  }
}
