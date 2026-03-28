/**
 * Polymarket Impulse Monitoring Bot
 * Monitors any market by slug, detects sudden price impulses, buys rising side, trails, hedges on 5% drop.
 */

import "dotenv/config";
import { PolymarketClient } from "./clients/polymarket";
import { MongoDBClient } from "./clients/mongodb";
import { ImpulseMonitor } from "./services/impulse-monitor";
import { RealtimePriceService } from "./services/realtime-price-service";
import { startAutoRedeemService } from "./services/auto-redeem-service";
import { createCredential } from "./security/createCredential";
import { runApprove } from "./security/allowance";
import { getClobClient } from "./providers/clobclient";
import { getProxyWalletBalanceUsd } from "./utils/balance";
import { loadHoldings } from "./utils/holdings";
import { tradingEnv, getDefaultImpulseConfig, maskAddress, isValidPrivateKey, isValidEvmAddress } from "./config/env";
import { logger } from "./logger";

const POLL_INTERVAL_MS = tradingEnv.IMPULSE_POLL_INTERVAL_MS;

async function main(): Promise<void> {
  logger.info("Polymarket Impulse Monitoring Bot");

  const polymarket = new PolymarketClient();
  const mongodb = new MongoDBClient();
  let realtimePriceService: RealtimePriceService | null = null;

  try {
    await mongodb.connect();
    logger.info("MongoDB");

    const config = await mongodb.getConfig();
    const effectiveConfig = config || getDefaultImpulseConfig();
    const prefix = effectiveConfig.slugPrefix ?? (effectiveConfig as { slug?: string }).slug ?? "";
    if (!prefix?.trim()) {
      logger.warn("POLYMARKET_SLUG_PREFIX not set. Set in .env or via frontend config.");
    }

    const canTrade = isValidPrivateKey(tradingEnv.PRIVATE_KEY) && isValidEvmAddress(tradingEnv.PROXY_WALLET_ADDRESS);
    if (canTrade) {
      await createCredential();
      try {
        logger.info("Approving USDC allowance…");
        const clob = await getClobClient();
        await runApprove(clob);
        const { balanceUsd, allowanceUsd } = await getProxyWalletBalanceUsd(clob);
        const allowStr = allowanceUsd >= 1e20 ? "max" : allowanceUsd.toFixed(2);
        logger.info(`Balance $${balanceUsd.toFixed(2)}, allowance $${allowStr}`);
        const proxy = (tradingEnv.PROXY_WALLET_ADDRESS ?? "").trim();
        logger.info(proxy ? `Trading: proxy ${maskAddress(proxy)}` : "Trading: EOA");
      } catch (err) {
        logger.error("Trading init failed", err);
      }
    } else {
      logger.info("Trading init skipped (valid PRIVATE_KEY + proxy wallet required)");
    }

    realtimePriceService = new RealtimePriceService();
    realtimePriceService.setOnPriceUpdate(async (upTokenId, downTokenId, upPrice, downPrice) => {
      try {
        const state = await mongodb.getImpulseState();
        await mongodb.setImpulseState({
          ...(state || {}),
          upPrice,
          downPrice,
          upTokenId,
          downTokenId,
        });
      } catch (_) {}
    });

    const monitor = new ImpulseMonitor(polymarket, mongodb, realtimePriceService);

    startAutoRedeemService(mongodb);

    const runCycle = async () => {
      try {
        await monitor.processCycle();
      } catch (err) {
        logger.error("Cycle error", err);
      }
    };

    await runCycle();
    setInterval(runCycle, POLL_INTERVAL_MS);

    const updateBalanceAndPosition = async () => {
      try {
        if (!isValidPrivateKey(tradingEnv.PRIVATE_KEY)) return;
        const state = await mongodb.getImpulseState();
        if (!state) return;

        const clob = await getClobClient();
        const { balanceUsd } = await getProxyWalletBalanceUsd(clob);
        await mongodb.patchImpulseState({ walletBalanceUsd: balanceUsd });

        const conditionId = state.conditionId as string | undefined;
        const upTokenId = state.upTokenId as string | undefined;
        const downTokenId = state.downTokenId as string | undefined;
        const upPrice = (state.upPrice as number) ?? 0;
        const downPrice = (state.downPrice as number) ?? 0;

        if (conditionId && upTokenId && downTokenId && (upPrice > 0 || downPrice > 0)) {
          const holdings = loadHoldings();
          const marketHoldings = holdings[conditionId] ?? {};
          const upShares = marketHoldings[upTokenId] ?? 0;
          const downShares = marketHoldings[downTokenId] ?? 0;
          const positionValueUsd = upShares * upPrice + downShares * downPrice;
          await mongodb.patchImpulseState({ positionValueUsd });
        } else {
          await mongodb.patchImpulseState({ positionValueUsd: 0 });
        }
      } catch (_) {}
    };

    updateBalanceAndPosition();
    setInterval(updateBalanceAndPosition, 5_000);

    logger.info(`Impulse bot running (poll ${POLL_INTERVAL_MS}ms)`);
  } catch (err) {
    logger.error("Failed to start", err);
    await mongodb.disconnect();
    process.exit(1);
  }

  process.on("SIGINT", async () => {
    logger.info("Shutting down…");
    realtimePriceService?.shutdown();
    await mongodb.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
