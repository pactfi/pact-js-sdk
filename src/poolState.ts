import { Buffer } from "buffer";

import { decode, decodeUint64Array } from "./encoding";

/**
 * The one to one representation of pool's global state.
 * The optional properties are used only by stableswaps and should not be relevant to the users.
 */
export type AppInternalState = {
  L: number;
  A: number;
  B: number;
  LTID: number;
  ASSET_A: number;
  ASSET_B: number;
  FEE_BPS: number;

  // Stableswaps only below.
  PACT_FEE_BPS?: number;
  INITIAL_A?: number;
  INITIAL_A_TIME?: number;
  FUTURE_A?: number;
  FUTURE_A_TIME?: number;
  ADMIN?: string;
  FUTURE_ADMIN?: string;
  ADMIN_TRANSFER_DEADLINE?: number;
  TREASURY?: string;
  PRIMARY_FEES?: number;
  SECONDARY_FEES?: number;
};

/**
 * A user friendly representation of pool's global state.
 */
export type PoolState = {
  totalLiquidity: number;
  totalPrimary: number;
  totalSecondary: number;
  primaryAssetPrice: number;
  secondaryAssetPrice: number;
};

/**
 *
 * @param rawState The contract's global state retrieved from algosdk.
 */
export function parseGlobalPoolState(rawState: any[]): AppInternalState {
  const state = parseState(rawState);

  // Old contracts don't have CONFIG (testnet only). The default is [0, 0, 30].
  const CONFIG = state.CONFIG ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAe";
  delete state.CONFIG;
  const [ASSET_A, ASSET_B, FEE_BPS] = decodeUint64Array(CONFIG);
  return { ASSET_A, ASSET_B, FEE_BPS, ...state };
}

/**
 * Utility function for converting the Algorand key-value schema into a standard python dictionary.
 *
 * Algorand store keys in base64 encoding and store values as either bytes or unsigned integers depending
 * on the type. This function decodes this information into a more human friendly structure.
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
