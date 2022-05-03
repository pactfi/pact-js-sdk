import { Buffer } from "buffer";

import { decode, decodeUint64Array } from "./encoding";

/**
 * The internal state of the liquidity pool application.
 * Includes the asset id, amount of each asset and the fee in bps.
 */
export type AppInternalState = {
  L: number;
  A: number;
  B: number;
  LTID: number;
  ASSET_A: number;
  ASSET_B: number;
  FEE_BPS: number;
};

/**
 * Simple data structure with the pools current state.
 */
export type PoolState = {
  totalLiquidity: number;
  totalPrimary: number;
  totalSecondary: number;
  primaryAssetPrice: number;
  secondaryAssetPrice: number;
};

export function parseGlobalPoolState(rawState: any[]): AppInternalState {
  const state = parseState(rawState);

  // Old contracts don't have CONFIG (testnet only). The default is [0, 0, 30].
  const CONFIG = state.CONFIG ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAe";
  delete state.CONFIG;
  const [ASSET_A, ASSET_B, FEE_BPS] = decodeUint64Array(CONFIG);
  return { ASSET_A, ASSET_B, FEE_BPS, ...state };
}

/**
 * Utility function for converting the algrand key-value schema into a standard python dictionary.
 *
 * Algorand store keys in base 64 encoding and store values as either bytes or unsigned integers depending
 * on the type. This function decodes this information into a python dictionary that is easier to handle.
 *
 * @param kv Algorand key-value data structure to parse.
 * @returns key value dictionary parsed from the argument
 */
export function parseState(kv: any) {
  // Transform algorand key-value schema.
  const res: any = {};
  for (const elem of kv) {
    const key = decode(Buffer.from(elem["key"], "base64"));
    let val: string | number;
    if (elem["value"]["type"] == 1) {
      val = elem["value"]["bytes"];
    } else {
      val = elem["value"]["uint"];
    }
    res[key] = val;
  }
  return res;
}
