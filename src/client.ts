import algosdk from "algosdk";

import { ApiListPoolsResponse, ListPoolsOptions, listPools } from "./api";
import { Asset, fetchAssetByIndex } from "./asset";
import { Config, Network, getConfig } from "./config";
import { PactSdkError } from "./exceptions";
import { ConstantProductFactory, getPoolFactory } from "./factories";
import { PactFarmingClient } from "./farming";
import { getGasStation, setGasStation } from "./gasStation";
import { Pool, fetchPoolById, fetchPoolsByAssets } from "./pool";

/**
 * An entry point for interacting with the SDK.
 *
 * Exposes convenience methods for fetching assets and pools and provides PoolCreator, which can be used to create new pools in Pact.
 *
 * Example usage:
 * ```
 * import algosdk from "algosdk";
 * import pactsdk from "@pactfi/pactsdk";
 *
 * const algod = new algosdk.Algodv2(token, url, port);
 * const pact = new pactsdk.PactClient(algod, {network: "testnet"});
 *
 * const algo = await pact.fetchAsset(0);
 * const otherCoin = await pact.fetchAsset(12345678);
 *
 * const pools = await pact.fetchPoolsByAssets(algo, otherCoin);
 */
export class PactClient {
  /**
   * Algorand client to work with.
   */
  algod: algosdk.Algodv2;

  /**
   * Client configuration with global contracts ids etc.
   */
  config: Config;

  farming: PactFarmingClient;

  /**
   * @param algod Algorand client to work with.
   * @param network The Algorand network to use the client with. The configuration values depend on the chosen network.
   * @param options Use it to overwrite configuration parameters.
   */
  constructor(
    algod: algosdk.Algodv2,
    options: Partial<Config & { network: Network }> = {},
  ) {
    this.algod = algod;
    const network = options.network ?? "mainnet";
    delete options.network;
    this.config = getConfig(network, options);
    this.farming = new PactFarmingClient(algod);

    try {
      getGasStation();
    } catch {
      setGasStation(this.config.gasStationId);
    }
  }

  /**
   * A convenient method for fetching ASAs (Algorand Standard Asset).
   *
   * This will return an Asset class with the relevant data about the asset if the asset index is valid. Note that an index of zero (0) will return the Algo asset.
   *
   * @param assetIndex The id of the asset.
   *
   * @throws PactSdkError If the asset does not exist.
   *
   * @returns Promise that will return an [[Asset]] object for the id.
   */
  fetchAsset(assetIndex: number): Promise<Asset> {
    return fetchAssetByIndex(this.algod, assetIndex);
  }

  /**
   * Returns a list of pools according to the pool options passed in. Uses Pact API for fetching the data.
   *
   * This method is deprecated but is kept for backward compatibility. Pact is in the process of changing the way the pools are created. In the future, all pools will be created using a pool factory contract which allows for an on-chain discoverability of pools.
   *
   * @param options API call parameters.
   *
   * @returns Paginated list of pools.
   */
  listPools(options: ListPoolsOptions = {}): Promise<ApiListPoolsResponse> {
    if (!this.config.apiUrl) {
      throw new PactSdkError("No apiUrl provided in the config.");
    }
    return listPools(this.config.apiUrl, options);
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
      this.config.apiUrl,
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

  /**
   * Gets the constant product pool factory according to the client's configuration.
   */
  async getConstantProductPoolFactory(): Promise<ConstantProductFactory> {
    return getPoolFactory(this.algod, "CONSTANT_PRODUCT", this.config);
  }

  /**
   * Gets the NFT constant product pool factory according to the client's configuration.
   */
  async getNftConstantProductPoolFactory(): Promise<ConstantProductFactory> {
    return getPoolFactory(this.algod, "NFT_CONSTANT_PRODUCT", this.config);
  }
}
