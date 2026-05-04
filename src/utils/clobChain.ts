import { Chain } from "@polymarket/clob-client-v2";

export function toClobChain(chainId: number): Chain {  if (chainId === Chain.AMOY) return Chain.AMOY;
  return Chain.POLYGON;
}
