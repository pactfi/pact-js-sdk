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
  pactApiUrl: string;

  /**
   * Constructor for the Pact Client class.
   *
   * @param algod Algorand client to work with.
   * @param options Client configuration options.
   */
  constructor(public algod: algosdk.Algodv2, options: ClientOptions = {}) {
    this.pactApiUrl = options.pactApiUrl ?? "https://api.pact.fi";
  }

  /**
   * A convenient method for fetching ASAs (Algorand Standard Asset).
   *
   * @param assetIndex The id number for the ASA asset.
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
   * First, it uses Pact API retrieve app ids matching the provided assets and then uses algod client to fetch contracts data from the blockchain.
   *
   * @param primaryAsset Primary asset for the pool to find.
   * @param secondaryAsset Secondary asset for the pool to find.
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
   * @param appId The application of id pool to return.
   *
   * @returns The pool for the application id.
   */
  fetchPoolById(appId: number): Promise<Pool> {
    return fetchPoolById(this.algod, appId);
  }
}
