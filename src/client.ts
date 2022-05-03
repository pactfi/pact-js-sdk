import algosdk from "algosdk";

import { Asset, fetchAssetByIndex } from "./asset";
import {
  ApiListPoolsResponse,
  ListPoolsOptions,
  Pool,
  fetchPoolById,
  fetchPoolsByAssets,
  listPools,
} from "./pool";

/** A type that contains all the possible options to be sent to a client. Currently this contains only the URL for the API. */
export type AllClientOptions = {
  pactApiUrl?: string;
};

/** ClientOptions an AllClientOptions populated as Optional allowing it to represent all possible AllClientOPtions values. */
export type ClientOptions = Partial<AllClientOptions>;

/**
 * A simple class for interfacing with contracts on the pact exchange.
 *
 * The module wraps the Algorand Client to allow you to query information
 * either on the pact exchange or relevant to the exchange.
 * It is primary used to get a list of the current pools,
 * either by asset, by id or overall.
 *
 * Example usage:
 * ```
 * import algosdk from "algosdk";
 * import pactsdk from "@pactfi/pactsdk";
 *
 * const algod = new algosdk.Algodv2(token, url, port);
 * const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});
 *
 * const algo = await pact.fetchAsset(0);
 * const otherCount = await pact.fetchAsset(12345678);
 *
 * const pools = await pact.fetchPoolsByAssets(algo, othercoin);
 * ```
 */
export class PactClient {
  pactApiUrl: string;

  /**
   * Constructor for the Pact Client class.
   *
   * @param algod Algorand client that the public client
   * @param options options json data. Only current member is the pactApiUrl - the api address to access.
   */
  constructor(public algod: algosdk.Algodv2, options: ClientOptions = {}) {
    this.pactApiUrl = options.pactApiUrl ?? "https://api.pact.fi";
  }

  /**
   * Asynchronous method to return an [[Asset]] object for given index.
   *
   * @param assetIndex The id number for the ASA asset.
   * @returns Promise that will return an [[Asset]] object for the id if exists.
   */
  fetchAsset(assetIndex: number): Promise<Asset> {
    return fetchAssetByIndex(this.algod, assetIndex);
  }

  /**
   * Returns a list of pools according to the pool options passed in.
   *
   * @param options json options passed to get a list of the pools.
   * @returns
   */
  listPools(options: ListPoolsOptions = {}): Promise<ApiListPoolsResponse> {
    if (!this.pactApiUrl) {
      throw Error("No pactApiUrl provided.");
    }
    return listPools(this.pactApiUrl, options);
  }
  /**
   * Returns a list of liquidity pools on Pact that are across the primary and secondary assets.
   *
   * @param primaryAsset primary asset for the pool to find.
   * @param secondaryAsset secondary asset for the pool to find.
   * @returns list of pools for the two assets, the list may be empty.
   */
  async fetchPoolsByAssets(
    primaryAsset: Asset | number,
    secondaryAsset: Asset | number,
  ): Promise<Pool[]> {
    return fetchPoolsByAssets(
      this.algod,
      primaryAsset,
      secondaryAsset,
      this.pactApiUrl,
    );
  }

  /**
   * Fetch pool by the application id.
   *
   * @param appId The application of id pool to return.
   * @returns the pool for the application id.
   */
  async fetchPoolById(appId: number): Promise<Pool> {
    return fetchPoolById(this.algod, appId);
  }
}
