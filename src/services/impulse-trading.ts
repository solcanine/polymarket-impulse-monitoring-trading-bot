import { OrderType, Side } from "@polymarket/clob-client-v2";
import { getClobClient } from "../providers/clobclient";
import { addHoldings } from "../utils/holdings";
import { validateBuyOrderBalance } from "../utils/balance";
import { tradingEnv, isValidEvmAddress, isValidPrivateKey } from "../config/env";
import { logger } from "../logger";
import type { ImpulseBuyDoc, MarketInfo } from "../types";
import type { MongoDBClient } from "../clients/mongodb";

const TICK_SIZE = tradingEnv.TICK_SIZE;
const NEG_RISK = tradingEnv.NEG_RISK;

function clampPrice(price: number): number {
  const t = parseFloat(TICK_SIZE);
  return Math.max(t, Math.min(1 - t, price));
}

export async function buyToken(
  tokenId: string,
  side: "Up" | "Down",
  type: "initial" | "hedge",
  amountUsd: number,
  marketInfo: MarketInfo,
  mongodb?: MongoDBClient | null
): Promise<boolean> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  const proxyWallet = tradingEnv.PROXY_WALLET_ADDRESS;
  if (!isValidPrivateKey(privateKey) || !isValidEvmAddress(proxyWallet)) {
    logger.skip("Buy: valid PRIVATE_KEY + PROXY_WALLET_ADDRESS required");
    return false;
  }

  try {
    const client = await getClobClient();

    let currentPrice: number;
    try {
      const priceResp = await client.getPrice(tokenId, "BUY");
      if (typeof priceResp === "number" && Number.isFinite(priceResp)) {
        currentPrice = priceResp;
      } else if (typeof priceResp === "string") {
        currentPrice = parseFloat(priceResp) || 0.5;
      } else if (priceResp && typeof priceResp === "object") {
        const o = priceResp as Record<string, unknown>;
        const p = o.mid ?? o.price ?? o.BUY;
        currentPrice = typeof p === "number" ? p : parseFloat(String(p || "0.5")) || 0.5;
      } else {
        currentPrice = 0.5;
      }
    } catch {
      currentPrice = 0.5;
    }

    if (currentPrice <= 0 || currentPrice >= 1) {
      logger.error("Buy: invalid price");
      return false;
    }

    const orderPrice = clampPrice(currentPrice);
    const shares = amountUsd / currentPrice;

    const { valid } = await validateBuyOrderBalance(client, amountUsd);
    if (!valid) {
      logger.skip("Buy: insufficient balance/allowance");
      return false;
    }

    logger.buy(`${type} ${side}: $${amountUsd.toFixed(2)} @ ${currentPrice.toFixed(2)}`);

    const result = (await client.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        side: Side.BUY,
        amount: amountUsd,
        price: orderPrice,
        orderType: OrderType.FAK,
      },
      { tickSize: TICK_SIZE, negRisk: NEG_RISK },
      OrderType.FAK
    )) as { status?: string; makingAmount?: string; takingAmount?: string };

    const isSuccess =
      result &&
      (result.status === "FILLED" ||
        result.status === "PARTIALLY_FILLED" ||
        result.status === "matched" ||
        result.status === "MATCHED" ||
        !result.status);

    if (isSuccess) {
      let tokensReceived = result.takingAmount ? parseFloat(result.takingAmount) : shares;
      if (tokensReceived >= 1e6) tokensReceived = tokensReceived / 1e6;

      addHoldings(marketInfo.conditionId, tokenId, tokensReceived);

      if (mongodb) {
        const doc: ImpulseBuyDoc = {
          conditionId: marketInfo.conditionId,
          eventSlug: marketInfo.eventSlug,
          side,
          type,
          tokenId,
          price: currentPrice,
          amountUsd,
          shares: tokensReceived,
          boughtAt: Math.floor(Date.now() / 1000),
        };
        await mongodb.saveImpulseBuy(doc).catch((err) => logger.error("saveImpulseBuy failed", err));
      }

      logger.ok(`BUY ${type} ${side}: ${tokensReceived.toFixed(2)} shares`);
      return true;
    }

    logger.error("BUY: order not filled");
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`BUY ${type} ${side}: ${msg}`);
    return false;
  }
}
