import { ApiKeyCreds, ClobClient } from "@polymarket/clob-client-v2";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { Wallet } from "@ethersproject/wallet";
import { tradingEnv, maskAddress } from "../config/env";
import { logger } from "../logger";
import { CREDENTIAL_PATH } from "../config/paths";
import { toClobChain } from "../utils/clobChain";

type StoredCredential = ApiKeyCreds & {
  walletAddress?: string;
  chainId?: number;
  host?: string;
};

function loadFromFile(): StoredCredential | null {
  if (!existsSync(CREDENTIAL_PATH)) return null;
  try {
    const cred = JSON.parse(readFileSync(CREDENTIAL_PATH, "utf-8")) as StoredCredential;
    return cred?.key ? cred : null;
  } catch {
    return null;
  }
}

export async function createCredential(): Promise<ApiKeyCreds | null> {
  const privateKey = tradingEnv.PRIVATE_KEY;
  if (!privateKey) {
    logger.skip("Credential: PRIVATE_KEY not set");
    return null;
  }

  try {
    const wallet = new Wallet(privateKey);
    const currentWallet = wallet.address.toLowerCase();
    const chain = toClobChain(tradingEnv.CHAIN_ID);
    const host = tradingEnv.CLOB_API_URL;

    const existing = loadFromFile();
    if (existing?.key && existing.walletAddress && existing.walletAddress.toLowerCase() === currentWallet) {
      logger.info("Using credential from credential.json");
      return existing;
    }

    const clobClient = new ClobClient({ host, chain, signer: wallet });
    const credential = await clobClient.createOrDeriveApiKey();

    const dir = resolve(process.cwd(), "src/data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stored: StoredCredential = {
      ...credential,
      walletAddress: wallet.address,
      chainId: tradingEnv.CHAIN_ID,
      host,
    };
    writeFileSync(CREDENTIAL_PATH, JSON.stringify(stored, null, 2));

    logger.ok(`Credential saved for ${maskAddress(wallet.address)}`);
    return credential;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Credential: ${msg}`);
    return null;
  }
}
