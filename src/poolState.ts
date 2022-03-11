import { Buffer } from "buffer";

import { decode, decodeUint64Array } from "./encoding";

export type AppInternalState = {
  L: number;
  A: number;
  B: number;
  LTID: number;
  ASSET_A: number;
  ASSET_B: number;
  FEE_BPS: number;
};

export type PoolState = {
  totalLiquidity: number;
  totalPrimary: number;
  totalSecondary: number;
  primaryAssetPrice: number;
  secondaryAssetPrice: number;
};

export function parseGlobalPoolState(rawState: any[]): AppInternalState {
  const state = parseState(rawState);
  const CONFIG = state.CONFIG;
  delete state.CONFIG;
  const [ASSET_A, ASSET_B, FEE_BPS] = decodeUint64Array(CONFIG);
  return { ASSET_A, ASSET_B, FEE_BPS, ...state };
}

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
