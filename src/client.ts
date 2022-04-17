import algosdk from "algosdk";

import { ApiListPoolsResponse, ListPoolsOptions, listPools } from "./api";
import { Asset, fetchAssetByIndex } from "./asset";
import { Pool, fetchPoolById, fetchPoolsByAssets } from "./pool";

/** A type that contains all the possible options to be sent to a client. Currently this contains only the URL for the API. */
export type AllClientOptions = {
  pactApiUrl?: string;
};

/** ClientOptions an AllClientOptions populated as Optional allowing it to represent all possible AllClientOPtions values. */
export type ClientOptions = Partial<AllClientOptions>;

/**
 * An entry point for interacting with the SDK.
 *
 * Exposes convenience methods for fetching assets and pools.
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
 * const otherCoin = await pact.fetchAsset(12345678);
 *
 * const pools = await pact.fetchPoolsByAssets(algo, otherCoin);
 * ```
 */
export class PactClient {
  /**
   * Algorand client to work with.
   */
  algod: algosdk.Algodv2;

  /**
   * Pact API URL to use.
   */
  pactApiUrl: string;

  /**
   * @param algod Algorand client to work with.
   * @param options Client configuration options.
   */
  constructor(algod: algosdk.Algodv2, options: ClientOptions = {}) {
    this.algod = algod;
    this.pactApiUrl = options.pactApiUrl ?? "https://api.pact.fi";
  }

  /**
   * A convenient method for fetching ASAs (Algorand Standard Asset).
   *
   * This will return an Asset class with the relevant data about the asset if the asset index is valid. Note that an index of zero (0) will return the Algo asset.
   *
   * @param assetIndex The id of the asset.
   *
   * @throws If the asset does not exist.
   *
   * @returns Promise that will return an [[Asset]] object for the id.
   */
  fetchAsset(assetIndex: number): Promise<Asset> {
    return fetchAssetByIndex(this.algod, assetIndex);
  }

  /**
   * Returns a list of pools according to the pool options passed in. Uses Pact API for fetching the data.
   *
   * @param options API call parameters.
   *
   * @returns Paginated list of pools.
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
   * First, it uses Pact API retrieve app ids matching the provided assets and then uses algod client to fetch contracts data from the blockchain.
   *
   * @param primaryAsset Primary asset or the asset id for the pool to find.
   * @param secondaryAsset Secondary asset or the asset id for the pool to find.
   *
   * @returns List of [[Pool]] for the two assets, the list may be empty.
   */
  fetchPoolsByAssets(
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
   * Fetches the pool by the application id. It uses algod client to fetch the data directly from the blockchain.
   *
   * @param appId The application id of pool to return.
   *
   * @returns The pool for the application id.
   */
  fetchPoolById(appId: number): Promise<Pool> {
    return fetchPoolById(this.algod, appId);
  }
}
