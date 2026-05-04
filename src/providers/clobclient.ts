import { readFileSync, existsSync } from "fs";
import { Chain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import type { ApiKeyCreds } from "@polymarket/clob-client-v2";
import { Wallet } from "@ethersproject/wallet";
import { tradingEnv } from "../config/env";
import { CREDENTIAL_PATH } from "../config/paths";
import { toClobChain } from "../utils/clobChain";

let cachedClient: ClobClient | null = null;
let cachedConfig: { chain: Chain; host: string } | null = null;

async function ensureCredential(): Promise<void> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) return;

  let storedWalletAddress: string | undefined;
  if (existsSync(CREDENTIAL_PATH)) {
    try {
      const stored = JSON.parse(readFileSync(CREDENTIAL_PATH, "utf-8")) as { walletAddress?: string };
      storedWalletAddress = stored.walletAddress;
    } catch {
      storedWalletAddress = undefined;
    }
  }

  const wallet = new Wallet(privateKey);
  if (existsSync(CREDENTIAL_PATH) && storedWalletAddress && storedWalletAddress.toLowerCase() === wallet.address.toLowerCase()) {
    return;
  }

  if (tradingEnv.PRIVATE_KEY) {
    const { createCredential } = await import("../security/createCredential");
    await createCredential();
  }
}

export async function getClobClient(): Promise<ClobClient> {
  await ensureCredential();

  if (!existsSync(CREDENTIAL_PATH)) {
    throw new Error(
      "Credential file not found. Set PRIVATE_KEY in .env to create from Polymarket, " +
        "or place a credential.json at " +
        CREDENTIAL_PATH
    );
  }

  const raw = JSON.parse(readFileSync(CREDENTIAL_PATH, "utf-8")) as Partial<ApiKeyCreds> & { walletAddress?: string };
  const creds = raw as ApiKeyCreds;
  const chain = toClobChain(tradingEnv.CHAIN_ID);
  const host = tradingEnv.CLOB_API_URL;

  if (cachedClient && cachedConfig && cachedConfig.chain === chain && cachedConfig.host === host) {
    return cachedClient;
  }

  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not found in .env");

  const wallet = new Wallet(privateKey);
  const secretBase64 = creds.secret.replace(/-/g, "+").replace(/_/g, "/");
  const apiKeyCreds: ApiKeyCreds = {
    key: creds.key,
    secret: secretBase64,
    passphrase: creds.passphrase,
  };

  const proxyWalletAddress = tradingEnv.PROXY_WALLET_ADDRESS;

  cachedClient = new ClobClient({
    host,
    chain,
    signer: wallet,
    creds: apiKeyCreds,
    signatureType: SignatureTypeV2.POLY_GNOSIS_SAFE,
    funderAddress: proxyWalletAddress || undefined,
  });
  cachedConfig = { chain, host };
  return cachedClient;
}
