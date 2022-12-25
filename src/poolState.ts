import {
  decodeAddressFromGlobalState,
  decodeBase64,
  decodeUint64Array,
} from "./encoding";
import { PoolType } from "./pool";
import { parseState } from "./utils";

/**
 * The one to one representation of pool's global state.
 * The optional properties are used only by stableswaps and should not be relevant to the users.
 */
export type AppInternalState = {
  // Name and version may be missing in older contracts.
  CONTRACT_NAME?: "PACT AMM" | "[SI] PACT AMM";
  VERSION?: number;

  L: number;
  A: number;
  B: number;
  LTID: number;
  ASSET_A: number;
  ASSET_B: number;
  FEE_BPS: number;

  // Those may be missing in older contracts.
  PACT_FEE_BPS?: number;
  ADMIN?: string;
  FUTURE_ADMIN?: string;
  TREASURY?: string;
  PRIMARY_FEES?: number;
  SECONDARY_FEES?: number;

  // Stableswaps only below.
  INITIAL_A?: number;
  INITIAL_A_TIME?: number;
  FUTURE_A?: number;
  FUTURE_A_TIME?: number;
  PRECISION?: number;
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

  if (state.CONTRACT_NAME) {
    state.CONTRACT_NAME = decodeBase64(state.CONTRACT_NAME);
  }

  if (state.ADMIN) {
    state.ADMIN = decodeAddressFromGlobalState(state.ADMIN);
  }

  if (state.TREASURY) {
    state.TREASURY = decodeAddressFromGlobalState(state.TREASURY);
  }

  if (state.INITIAL_A === undefined) {
    const [ASSET_A, ASSET_B, FEE_BPS] = decodeUint64Array(CONFIG);
    return { ASSET_A, ASSET_B, FEE_BPS, ...state };
  } else {
    const [ASSET_A, ASSET_B, FEE_BPS, PRECISION] = decodeUint64Array(CONFIG);
    return { ASSET_A, ASSET_B, FEE_BPS, PRECISION, ...state };
  }
}

export function getPoolTypeFromInternalState(
  state: AppInternalState,
): PoolType {
  if (state.CONTRACT_NAME === "PACT AMM") {
    return "CONSTANT_PRODUCT";
  }
  if (state.CONTRACT_NAME === "[SI] PACT AMM") {
    return "STABLESWAP";
  }

  // Older contracts are missing CONTRACT_NAME. Let's assume it's our good old constant product.
  return "CONSTANT_PRODUCT";
}
