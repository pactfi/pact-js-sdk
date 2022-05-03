import algosdk from "algosdk";

/**
 * fetchAssetByIndex returns an Asset class with the details about the asset for a given id number.
 *
 * The function uses an internal cache so as to minimize the number of times the actual Algorand client is used
 * to look up the asset. This function is used through out the pact sdk to query asset information.
 *
 * @async
 * @param algod the Algorand client to query about the asset
 * @param index the Algorand Asset number to look up
 * @returns an Asset class for the asset number passed in.
 */
export async function fetchAssetByIndex(
  algod: algosdk.Algodv2,
  index: number,
): Promise<Asset> {
  if (Asset.assetsCache[index]) {
    return Asset.assetsCache[index];
  }

  let params: any;
  if (index > 0) {
    const assetInfo = await algod.getAssetByID(index).do();
    params = assetInfo.params;
  } else {
    params = {
      name: "Algo",
      "unit-name": "ALGO",
      decimals: 6,
    };
  }

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
 * The class includes basic details of the asset like name, unitName, number of
 * decimals supported and ratio from base units to unit.
 *
 * Example of usage:
 * ```
 *  Asset algo = fetchAssetByIndex(0);
 *
 *  console.log(algo.name);
 * ```
 *
 */
export class Asset {
  /**
   * A cache of the asset index to Asset to reduce the time for
   * looking up basic details about the asset.
   */
  static assetsCache: Record<number, Asset> = {};

  /**
   * The name of the Asset if there is one. This may be empty.
   */
  public name?= "";
  /**
   * The name of a unit of the asset if there is one. This may be empty.
   */
  public unitName?= "";

  /**
   * The number of decimal places that the Asset supports.
   */
  public decimals = 0;

  /**
   * The ratio between a base unit and the unit of the asset.
   * This is used to convert between an integer and floating point
   * representation of the asset without loss of precession.
   */
  public ratio = 1;

  /**
   * Creates an Asset class setting the index and Algorand client.
   *
   * Note that clients would not usually call this constructor themselves, instead use the fetchAssetByIndex
   * which creates the class and fills in the field values needed on the asset.
   *
   * @param algod the Algorand sdk client to use for extracting asset details.
   * @param index the index number of the asset.
   */
  constructor(protected algod: algosdk.Algodv2, public index: number) { }

  /**
   * This creates a transaction that will allow the account to "opt in" to the asset.
   *
   * The account needs to opt-in to an asset in order to hold an amount of the asset in the class.
   * This is usually done when preparing a swap if the account has not been created.
   *
   * @async
   *
   * @param address Account to opt in to this asset
   * @returns Transaction for opting in to this asset.
   */
  async prepareOptInTx(address: string) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    return this.buildOptInTx(address, suggestedParams);
  }

  /**
   * Creates the actual transaction for the account to opt-in to holding the asset.
   *
   * @param address address of the account to opt in to the asset.
   * @param suggestedParams the general parmaters for the transaction based on the particular client
   * @returns a transaction
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

  /**
   * Checks if the account is already able to hold this asset, that is it has already opted in.
   *
   * This functions should be called to check if the opt-in transaction needs to be created. See [prepareOptInTx].
   *
   * @param address The account to check if the asset is opted in on.
   * @returns true if the account is already opted in, false otherwise.
   */
  async isOptedIn(address: string): Promise<boolean> {
    const holding = await this.getHolding(address);
    return holding !== null;
  }

  /**
   * Returns the amount of holding of this asset the account has.
   *
   * Note that this function may return null if the account has not opted in for this asset.
   * @async
   * @param address the account to check the current holding
   * @returns the amount of this asset the account is holding, or null if it can't hold this asset.
   */
  async getHolding(address: string): Promise<number | null> {
    const accountInfo = await this.algod.accountInformation(address).do();
    return this.getHoldingFromAccountInformation(accountInfo);
  }

  /**
   * Used by getHolding to return the actual amount of asset from the accountInformation.
   *
   * @param accountInformation The account information to extract the asset holding from.
   * @returns the amount of asset or null if the asset is not in the account.
   */
  getHoldingFromAccountInformation(accountInformation: any) {
    for (const asset of accountInformation.assets) {
      if (asset["asset-id"] === this.index) {
        return asset.amount;
      }
    }
    return null;
  }
}
