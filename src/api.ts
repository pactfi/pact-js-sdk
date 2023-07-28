import { crossFetch } from "./crossFetch";
import { PoolType } from "./pool";

/**
 * Options for calling the [[listPools]] function.
 */
export type ListPoolsOptions = {
  offset?: string;
  limit?: string;
  is_verified?: string;
  creator?: string;
  primary_asset__on_chain_id?: string;
  secondary_asset__on_chain_id?: string;
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
  on_chain_id: string;
  confirmed_round: number;
  creator: string;
  fee_bps: number;
  fee_amount_7d: string;
  fee_amount_24h: string;
  fee_usd_7d: string;
  fee_usd_24h: string;
  tvl_usd: string;
  volume_7d: string;
  volume_24h: string;
  apr_7d: string;
  id: number;
  is_deprecated: boolean;
  is_verified: boolean;
  pool_asset: ApiAsset;
  primary_asset: ApiAsset;
  secondary_asset: ApiAsset;
  version: number;
};

/**
 * Details about the liquidity pool assets returned from the asset pool.
 */
export type ApiAsset = {
  on_chain_id: string;
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
 * Global data for contracts.
 */
export type AppGlobals = {
  nbs: number;
  nui: number;
};

/**
 * Possible transaction types.
 */
export type TxnType = "acfg" | "afrz" | "appl" | "axfer" | "keyreg" | "pay";

/**
 * Basic fields in compiled transaction.
 */
export type CompiledTxn = {
  fv: number;
  gen: string;
  gh: number[];
  lv: number;
  snd: number[];
  type: TxnType;
};

/**
 * Response from [[compileContract]] function containing information about pool that is going to be created.
 */
export type CompiledContract = CompiledTxn & {
  apan: number;
  apap: number[];
  apas: number[];
  apgs: AppGlobals;
  apsu: number[];
  fee: number;
  apep: number;
};

/**
 * Compiled funding transaction. Used to provide first funds into the newly created pool.
 */
export type CompiledAppFundTxn = CompiledTxn & {
  amt: number;
  fee: number;
  grp: number[];
  rcv: number[];
};

/**
 * Compiled Noop transaction. Used to optin to assets in the newly created pool.
 */
export type CompiledNoopTxn = CompiledTxn & {
  apaa: string[];
  apan: number;
  apas: number[];
  apid: number;
  fee: number;
  grp: number[];
  apat?: string[];
};

/**
 * Params for calling the [[compileContract]] function.
 */
export type CompileContractParams = {
  sender: string;
  primary_asset_id: string;
  secondary_asset_id: string;
  /**
   * An integer between 1 and 10_000.
   */
  fee_bps: number;
  pool_type?: PoolType;
};

/**
 * Params for calling the [[prepareContractTxns]] function.
 */
export type ContractTxnsParams = {
  appid: number;
  sender: string;
  primary_asset_id: string;
  secondary_asset_id: string;
  fee_bps: number;
};

/**
 * A blob from a signed transaction.
 */
export type TxnBlob = {
  blob: string;
};

/**
 * Contains appid of the newly created & deployed pool.
 */
export type DeployedContract = {
  appid: number;
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

/**
 * Compiles contract data.
 *
 * @param pactApiUrl The API URL.
 * @param params Information about sender, assets ids and desired fee bps.
 *
 * @returns Compiled contract data, to be used in transaction creation.
 */
export function compileContract(
  pactApiUrl: string,
  params: CompileContractParams,
) {
  return crossFetch<CompiledContract>(
    `${pactApiUrl}/api/contracts/compile`,
    "POST",
    params,
  );
}

/**
 * Deploys contract to the blockchain.
 *
 * @param pactApiUrl The API URL.
 * @param params Signed transaction blob.
 *
 * @returns The id of the newly deployed contract.
 */
export function deployContract(pactApiUrl: string, params: TxnBlob) {
  return crossFetch<DeployedContract>(
    `${pactApiUrl}/api/contracts/deploy`,
    "POST",
    params,
  );
}

/**
 * Prepares data to create transactions for funding the contract, creating liquidity tokens and opting-in assets.
 *
 * @param pactApiUrl The API URL.
 * @param params Required contract data.
 *
 * @returns An array of 3 data objects, to be used in transaction creation.
 */
export function prepareContractTxns(
  pactApiUrl: string,
  params: ContractTxnsParams,
) {
  return crossFetch<[CompiledAppFundTxn, CompiledNoopTxn, CompiledNoopTxn]>(
    `${pactApiUrl}/api/contracts/create_lt_and_optin_transactions`,
    "POST",
    params,
  );
}

/**
 * Sends all initial contract transactions prepared in [[prepareContractTxns]] function.
 *
 * @param pactApiUrl The API URL.
 * @param txs An array of three transaction blobs.
 *
 * @returns Pool data of successfully created, deployed and prepared contract.
 */
export function sendContractTxns(pactApiUrl: string, txs: TxnBlob[]) {
  return crossFetch<ApiPool>(
    `${pactApiUrl}/api/contracts/create_lt_and_optin`,
    "POST",
    { txs },
  );
}
