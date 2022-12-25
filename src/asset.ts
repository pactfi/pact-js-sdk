import algosdk from "algosdk";

import { encode } from "./encoding";

export function getCachedAsset(
  algod: algosdk.Algodv2,
  index: number,
  decimals: number,
): Asset {
  if (Asset.assetsCache[index]) {
    return Asset.assetsCache[index];
  }

  const asset = new Asset(algod, index);
  asset.decimals = decimals;
  return asset;
}

export function getAlgo(algod: algosdk.Algodv2) {
  const asset = new Asset(algod, 0);
  asset.name = "Algo";
  asset.unitName = "ALGO";
  asset.decimals = 6;
  asset.ratio = 10 ** asset.decimals;
  Asset.assetsCache[asset.index] = asset;
  return asset;
}

/**
 * Fetches an [[Asset]] class with the details about the asset for a given id number.
 *
 * The function uses an internal cache so as to minimize the number of times the actual Algorand client is used
 * to look up the asset. This function is used through out the pact sdk to query asset information.
 *
 * @param algod An Algorand client to query about the asset.
 * @param index An Algorand Asset number to look up.
 *
 * @returns An [[Asset]] instance for the asset number passed in.
 */
export async function fetchAssetByIndex(
  algod: algosdk.Algodv2,
  index: number,
): Promise<Asset> {
  if (Asset.assetsCache[index]) {
    return Asset.assetsCache[index];
  }

  if (index === 0) {
    return getAlgo(algod);
  }

  const assetInfo = await algod.getAssetByID(index).do();
  const params = assetInfo.params;

  const asset = new Asset(algod, index);
  asset.name = params.name;
  asset.unitName = params["unit-name"];
  asset.decimals = params.decimals;
  asset.ratio = 10 ** asset.decimals;

  Asset.assetsCache[index] = asset;
  return asset;
}

/**
 * Describes the basic data and the utility functions for an Algorand Standard Asset.
 *
 * Typically you don't create instances of this class manually. Use [[PactClient.fetchAsset]] instead.
 * Also, when instantiating the pool e.g. by using [[PactClient.fetchPoolById]] the missing pool assets are fetched automatically.
 */
export class Asset {
  /**
   * A cache of the asset index to [[Asset]] to reduce the time for
   * looking up basic details about the asset.
   */
  static assetsCache: Record<number, Asset> = {};

  /**
   * The Algorand sdk client to use for extracting asset details.
   */
  protected algod: algosdk.Algodv2;

  /**
   * The ID of the asset.
   */
  public index: number;

  /**
   * The name of the Asset if there is one. This may be empty.
   */
  public name? = "";
  /**
   * The name of a unit of the asset if there is one. This may be empty.
   */
  public unitName? = "";

  /**
   * The number of decimal places that the Asset supports.
   */
  public decimals = 0;

  /**
   * The ratio between a base unit and the unit of the asset.
   * This is used to convert between an integer and floating point
   * representation of the asset without loss of precision.
   */
  public ratio = 1;

  /**
   * Creates an Asset class setting the index and Algorand client.
   *
   * Note that clients would not usually call this constructor themselves.
   *
   * @param algod the Algorand sdk client to use for extracting asset details.
   * @param index the ID of the asset.
   */
  constructor(algod: algosdk.Algodv2, index: number) {
    this.algod = algod;
    this.index = index;
  }

  /**
   * This creates a transaction that will allow the account to "opt in" to the asset.
   *
   * In Algorand, every account has to explicitly opt-in for an asset before receiving it.
   *
   * Needed if you want to receive an asset from a swap or to manage liquidity tokens.
   *
   * @param address Account to opt in to this asset.
   * @returns Transaction for opting in to this asset.
   */
  async prepareOptInTx(address: string) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    return this.buildOptInTx(address, suggestedParams);
  }

  /**
   * Creates the actual transaction for the account to opt-in to holding the asset.
   *
   * @param address Address of the account to opt in to the asset.
   * @param suggestedParams Algorand suggested parameters for transactions.
   * @returns A transaction to opt-in into asset.
   */
  buildOptInTx(address: string, suggestedParams: algosdk.SuggestedParams) {
    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: address,
      to: address,
      amount: 0,
      assetIndex: this.index,
      suggestedParams,
    });
  }

  async prepareOptOutTx(address: string, closeTo: string) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    return this.buildOptOutTx(address, closeTo, suggestedParams);
  }

  buildOptOutTx(
    address: string,
    closeTo: string,
    suggestedParams: algosdk.SuggestedParams,
  ) {
    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: address,
      to: address,
      closeRemainderTo: closeTo,
      amount: 0,
      assetIndex: this.index,
      suggestedParams,
    });
  }

  /**
   * Checks if the account is already able to hold this asset, that is it has already opted in.
   *
   * This functions should be called to check if the opt-in transaction needs to be created. See [[prepareOptInTx]].
   *
   * @param address The account to check if the asset is opted in on.
   *
   * @returns True if the account is already opted in, false otherwise.
   */
  async isOptedIn(address: string): Promise<boolean> {
    const holding = await this.getHolding(address);
    return holding !== null;
  }

  /**
   * Returns the amount of holding of this asset the account has.
   *
   * Note that this function may return null if the account has not opted in for this asset.
   * @param address The account to check the current holding.
   *
   * @returns The amount of this asset the account is holding, or None if the account is not opted into the asset.
   */
  async getHolding(address: string): Promise<number | null> {
    const accountInfo = await this.algod.accountInformation(address).do();
    return this.getHoldingFromAccountInformation(accountInfo);
  }

  /**
   * @param accountInformation The account information to extract the asset holding from.
   *
   * @returns The amount of asset or null if the account is not opted into the asset.
   */
  getHoldingFromAccountInformation(accountInformation: any): number | null {
    if (this.index === 0) {
      return accountInformation.amount;
    }

    for (const asset of accountInformation.assets) {
      if (asset["asset-id"] === this.index) {
        return asset.amount;
      }
    }
    return null;
  }

  buildTransferTx(
    sender: string,
    receiver: string,
    amount: number,
    suggestedParams: algosdk.SuggestedParams,
    note = "",
  ): algosdk.Transaction {
    if (this.index === 0) {
      // ALGO
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: sender,
        to: receiver,
        amount,
        note: encode(note),
        suggestedParams,
      });
    }

    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: sender,
      to: receiver,
      amount,
      note: encode(note),
      suggestedParams,
      assetIndex: this.index,
    });
  }
}
