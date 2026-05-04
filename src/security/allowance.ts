import { MaxUint256 } from "@ethersproject/constants";
import { BigNumber } from "@ethersproject/bignumber";
import { parseUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { AssetType, ClobClient, getContractConfig } from "@polymarket/clob-client-v2";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { tradingEnv, getRpcUrl } from "../config/env";
import { logger } from "../logger";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

function log(msg: string): void {
  logger.info(msg);
}

function clobExchangeSpender(chainId: number): string {
  const cfg = getContractConfig(chainId);
  return cfg.exchangeV2 || cfg.exchange;
}

async function approveCollateralOnChainFromSafe(
  chainId: number,
  exchangeAddress: string,
  collateralAddress: string,
  privateKey: string,
  proxyAddress: string
): Promise<boolean> {
  if (!exchangeAddress || !collateralAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const token = new Contract(collateralAddress, ERC20_ABI, provider);
    const current = await token.allowance(proxyAddress, exchangeAddress);
    if (current.gte(MaxUint256)) {
      log("Approve: proxy (Safe) collateral allowance already MaxUint256");
      return true;
    }
    const data = token.interface.encodeFunctionData("approve", [exchangeAddress, MaxUint256]);
    const safeSdk = await Safe.init({
      provider: rpcUrl,
      signer: privateKey.startsWith("0x") ? privateKey : "0x" + privateKey,
      safeAddress: proxyAddress,
    });
    const safeTx = await safeSdk.createTransaction({
      transactions: [
        { to: collateralAddress, value: "0", data, operation: OperationType.Call },
      ],
    });
    const signed = await safeSdk.signTransaction(safeTx);
    const result = await safeSdk.executeTransaction(signed);
    log(`Approve: proxy (Safe) collateral approve tx sent: ${result.hash}`);
    await provider.waitForTransaction(result.hash, 1, 90_000).catch(() => {});
    return true;
  } catch (e: unknown) {
    log(`Approve: proxy (Safe) approve failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function approveCollateralOnChain(
  chainId: number,
  exchangeAddress: string,
  collateralAddress: string,
  privateKey: string
): Promise<boolean> {
  if (!exchangeAddress || !collateralAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
    const wallet = new Wallet(key, provider);

    let gasPrice: BigNumber;
    try {
      const networkGas = await provider.getGasPrice();
      gasPrice = networkGas.mul(120).div(100);
      if (gasPrice.lt(parseUnits("30", "gwei"))) gasPrice = parseUnits("30", "gwei");
    } catch {
      gasPrice = parseUnits("30", "gwei");
    }

    const token = new Contract(collateralAddress, ERC20_ABI, wallet);
    const tx = await token.approve(exchangeAddress, MaxUint256, {
      gasLimit: 100_000,
      gasPrice,
    });
    log(`Approve: on-chain collateral approve tx sent: ${tx.hash}`);
    await tx.wait(1);
    log("Approve: on-chain tx confirmed");
    return true;
  } catch (e: unknown) {
    const msg = String(e);
    if (msg.toLowerCase().includes("allowance") || msg.toLowerCase().includes("revert")) {
      log(`Approve: on-chain approve skipped (may already be set): ${msg}`);
      return true;
    }
    log(`Approve: on-chain collateral approve failed: ${msg}`);
    return false;
  }
}

export async function runApprove(client: ClobClient | null): Promise<boolean> {
  if (client == null) return false;

  let key = tradingEnv.PRIVATE_KEY ?? "";
  key = (key || "").trim();
  if (!key) return false;
  if (!key.startsWith("0x")) key = "0x" + key;

  const chainId = tradingEnv.CHAIN_ID ?? 137;
  const proxyAddress = (tradingEnv.PROXY_WALLET_ADDRESS ?? "").trim();
  const rpcConfigured =
    (tradingEnv.RPC_URL ?? "").trim().length > 0 || (tradingEnv.RPC_TOKEN ?? "").trim().length > 0;

  try {
    const config = getContractConfig(chainId);
    const exchangeSpender = clobExchangeSpender(chainId);
    if (!rpcConfigured) {
      log("Approve: RPC not configured (RPC_URL/RPC_TOKEN missing) — skipping on-chain approve");
    } else {
      if (proxyAddress) {
        log("Approve: proxy (Safe) set — approving collateral for CLOB exchange");
        await approveCollateralOnChainFromSafe(chainId, exchangeSpender, config.collateral, key, proxyAddress);
      }
      await approveCollateralOnChain(chainId, exchangeSpender, config.collateral, key);
    }
  } catch (e) {
    log(`Approve: on-chain approve step failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (typeof client.updateBalanceAllowance !== "function") return true;
  try {
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    log("Approve: collateral API allowance updated (CLOB v2)");
    await new Promise((r) => setTimeout(r, 2000));
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  } catch (e) {
    log(`Approve: API step failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}
