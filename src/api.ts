import { crossFetch } from "./crossFetch";

/**
 * Options for calling the [[listPools]] function.
 */
export type ListPoolsOptions = {
  offset?: string;
  limit?: string;
  is_verified?: string;
  creator?: string;
  primary_asset__algoid?: string;
  secondary_asset__algoid?: string;
  primary_asset__unit_name?: string;
  secondary_asset__unit_name?: string;
  primary_asset__name?: string;
  secondary_asset__name?: string;
};

/**
 * Response from [[listPools]] function containing pagination information and results.
 */
export type ApiListPoolsResponse = {
  count: number;
  offset: number;
  limit: number;
  results: ApiPool[];
};

/**
 * The individual pool information returned from [[listPools]], this contains the basic pool information.
 */
export type ApiPool = {
  address: string;
  appid: string;
  confirmed_round: number;
  creator: string;
  fee_amount_7d: string;
  fee_amount_24h: string;
  fee_usd_7d: string;
  fee_usd_24h: string;
  tvl_usd: string;
  volume_7d: string;
  volume_24h: string;
  apr_7d: string;
  id: number;
  is_verified: boolean;
  pool_asset: ApiAsset;
  primary_asset: ApiAsset;
  secondary_asset: ApiAsset;
};

/**
 * Details about the liquidity pool assets returned from the asset pool.
 */
export type ApiAsset = {
  algoid: string;
  decimals: number;
  id: number;
  is_liquidity_token: boolean;
  is_verified: boolean;
  name: string;
  total_amount: string;
  tvl_usd: string;
  unit_name: string;
  volume_7d: string;
  volume_24h: string;
};

/**
 * Finds all the pools that match the pool options passed in.
 *
 * @param pactApiUrl The API URL to query the list of pools.
 * @param options List of options for querying the pools.
 *
 * @returns Pool data for all pools in the Pact that meets the pool options.
 *
 */
export function listPools(pactApiUrl: string, options: ListPoolsOptions) {
  const params = new URLSearchParams(options);
  return crossFetch<ApiListPoolsResponse>(
    `${pactApiUrl}/api/pools?${params.toString()}`,
  );
}
