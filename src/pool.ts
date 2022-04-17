/**
 * @fileoverview Contains functions and classes that allow access information about or interacting with a Pact AMM Liquidity Pool.
 *
 * The main element is the Pool class which contains functions for adding and removing liquidity from the pool
 *
 * @package
 */
import algosdk from "algosdk";
import D from "decimal.js";

import { Asset, fetchAssetByIndex } from "./asset";
import { crossFetch } from "./crossFetch";
import { encode, encodeArray } from "./encoding";
import { PoolCalculator } from "./poolCalculator";
import { AppInternalState, PoolState, parseGlobalPoolState } from "./poolState";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";

/**
 * The arguments to add liquidity to the pool.
 *
 */
export type AddLiquidityOptions = {
  /** Account address to take the primary and secondary asset and deposit the lp asset. */
  address: string;

  /** The amount of primary asset to deposit when adding liquidity. */
  primaryAssetAmount: number;

  /** The amount of secondary asset to deposit when adding liquidity. */
  secondaryAssetAmount: number;

  /** An optional note that can be added to the application ADDLIQ transaction when executed. */
  note?: Uint8Array;
};

/** The arguments for removing liquidity from the pool. */
export type RemoveLiquidityOptions = {
  /** Account address to remove the lp asset and deposit the primary and secondary asset to. */
  address: string;

  /** The amount of the lp asset to return to the pool. */
  amount: number;
};

/**
 * Options for creating a [[Swap]].
 */
export type SwapOptions = {
  /**The asset to swap. */
  asset: Asset;

  /**Amount to swap or to receive. Look at `reverse` flag for details. */
  amount: number;

  /** Slippage in percents e.g. `10` is 10%. */
  slippagePct: number;

  /**
   * If false or not provided, the `amount` is the amount to swap (deposit in the contract).
   * if true, the `amount` is the amount to receive from the swap.
   */
  reverse?: boolean;
};

/** The arguments used to generate the swap. */
export type SwapTxOptions = {
  swap: Swap;
  address: string;
};

/**
 * options for calling the [[listPools]] function.
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
 * the individual pool information returned from listPools, this contains the basic information from the pool
 * including the primary and secondary assets, the ids and addresses and trading statistics.
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
 * This includes ids, name, decimal representation and current liquidity volume
 * plus basic trading analytics.
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

export type PoolType = "CONSTANT_PRODUCT" | "STABLESWAP";

/**
 * The basic three operation types in a PACT liquidity pool, namely Add Liquidity (ADDLIQ), Remove Liquidity (REMLIQ) and trade a swap.
 */
export type OperationType = "SWAP" | "ADDLIQ" | "REMLIQ";

export type MakeNoopTxOptions = {
  address: string;
  suggestedParams: algosdk.SuggestedParams;
  fee: number;
  args: (OperationType | number)[];
  extraAsset?: Asset;
  note?: Uint8Array;
};

export type MakeDepositTxOptions = {
  address: string;
  asset: Asset;
  amount: number;
  suggestedParams: algosdk.SuggestedParams;
};

export type SuggestedParamsOption = {
  suggestedParams: algosdk.SuggestedParams;
};

/**
 * Finds all the pools that match the pool options passed in.
 *
 * @param pactApiUrl URL to query the list of pools.
 * @param options List of options for querying the pools.
 *
 * @returns Pool data for all pools in the pact that meets the pool options.
 *
 */
export function listPools(pactApiUrl: string, options: ListPoolsOptions) {
  const params = new URLSearchParams(options);
  return crossFetch<ApiListPoolsResponse>(
    `${pactApiUrl}/api/pools?${params.toString()}`,
  );
}

/**
 * Fetches the global state of the of an application.
 *
 * @param algod The algo client to query the app in.
 * @param appId The application id to fetch the state of.
 *
 * @returns The global state of the application.
 */
export async function fetchAppState(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<AppInternalState> {
  const appData = await algod.getApplicationByID(appId).do();
  return parseGlobalPoolState(appData.params["global-state"]);
}

/**
 * Fetches the pool from the blockchain using the provided algod client.
 * The fetched data includes application state and primary, secondary and liquidity asset.
 *
 * @param algod The algo client to use.
 * @param appId The application id to fetch.
 */
export async function fetchPoolById(algod: algosdk.Algodv2, appId: number) {
  const appState = await fetchAppState(algod, appId);

  const [primaryAsset, secondaryAsset, liquidityAsset] = await Promise.all([
    fetchAssetByIndex(algod, appState.ASSET_A),
    fetchAssetByIndex(algod, appState.ASSET_B),
    fetchAssetByIndex(algod, appState.LTID),
  ]);

  return new Pool(
    algod,
    appId,
    primaryAsset,
    secondaryAsset,
    liquidityAsset,
    appState,
  );
}

/**
 * Returns the list of [[Pool]] for the assets passed in. Note there can be zero if there are no pools, or multiple if there are multiple at different fees.
 *
 * @param algod The algo client to use.
 * @param assetA One of the assets in the pool (asset id or [[Asset]])
 * @param assetB The other asset in the pool (asset id or [[Asset]])
 * @param pactApiUrl The API url to use
 *
 * @returns A list of pools matching the provided assets.
 */
export async function fetchPoolsByAssets(
  algod: algosdk.Algodv2,
  assetA: Asset | number,
  assetB: Asset | number,
  pactApiUrl: string,
): Promise<Pool[]> {
  const assets = [assetA, assetB].map((a) =>
    a instanceof Asset ? a.index : a,
  );

  // Make sure that the user didn't mess up assets order.
  // Primary asset always has lower index.
  const [primaryAsset, secondaryAsset] = assets.sort((a, b) => a - b);

  if (!pactApiUrl) {
    return Promise.reject("Must provide pactApiUrl.");
  }

  const appIds = await getAppIdsFromAssets(
    pactApiUrl,
    primaryAsset,
    secondaryAsset,
  );

  return Promise.all(appIds.map((appId) => fetchPoolById(algod, appId)));
}

/**
 * Returns the application ids for any pools that match the primary and secondary asset.
 *
 * This function finds any pools using the ApiUrl passed in that match the asset ids passed in.
 *
 * @param pactApiUrl The url for the pact AMM. This is used to which between the main and test sights.
 * @param primaryAssetIndex The algorand asset id for the primary asset of the pool.
 * @param secondaryAssetIndex The algorand asset id for the secondary asset of the pool.
 *
 * @returns array of asset id names.
 */
export async function getAppIdsFromAssets(
  pactApiUrl: string,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
): Promise<number[]> {
  const data = await listPools(pactApiUrl, {
    primary_asset__algoid: primaryAssetIndex.toString(),
    secondary_asset__algoid: secondaryAssetIndex.toString(),
  });
  return data.results.map((pool) => parseInt(pool.appid));
}

export type ConstantProductPoolParams = {
  feeBps: number;
};

export type StableswapPoolParams = {
  feeBps: number;
  pactFeeBps: number;
  initialA: number;
  initialATime: number;
  futureA: number;
  futureATime: number;
};

/**
 * Pool represents a liquidity pool in the PACT AMM.
 *
 * The class contains all the basic information about the pool. It is created with
 * the algo client, the application id, the primary, secondary and liquidity assets, the fees and the Internal State.
 *
 * The class is primarily called from the [PactClient] class, either fetching by the asset id or the pool id.
 *
 * The primary functions of the pool are to create the transaction groups to enable you to
 * * Add Liquidity,
 * * Removing Liquidity,
 * * Create a Swap on the Pool.
 *
 * # Example Usage
 * ## Adding Liquidity
 * ```typescript
 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

 // Get the algorand and pact clients. token, url and port need to be filled in.
 const algod = new algosdk.Algodv2(token, url, port);
 const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});

 const algo = await pact.fetchAsset(0);
 // this is just a made up asset, replace it with the asset for the pool you want to interact with.
 const otherCoin = await pact.fetchAsset(8949213);
 const pools = await pact.fetchPoolsByAssets(algo, otherCoin)

 // note checking that a pool has been returned has been omitted for brevity.

 // replace the '<mnemonic>' with the real account access code.
 const account = algosdk.mnemonicToSecretKey('<mnemonic>');

 // Now we create the transaction group.
 const addLiqTxGroup = await pools[0].prepareAddLiquidityTxGroup({
  address: account.addr,
  primaryAssetAmount: 100_000,
  secondaryAssetAmount: 50_000,
});
// sign the transaction group and send it to algorand. Wait for the confirmation.
const signedAddLiqTx = addLiqTxGroup.signTxn(account.sk);
const sentAddLiqTx = await algod.sendRawTransaction(signedAddLiqTx).do();
await algosdk.waitForConfirmation(algod, sentAddLiqTx.txId, 2);

```
*
* ## Removing Liquidity
```typescript
 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

 // Get the algorand and pact clients. token, url and port need to be filled in.
 const algod = new algosdk.Algodv2(token, url, port);
 const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});

 const algo = await pact.fetchAsset(0);
 // this is just a made up asset, replace it with the asset for the pool you want to interact with.
  const otherCoin = await pact.fetchAsset(8949213);
 const pools = await pact.fetchPoolsByAssets(algo, otherCoin)
// note checking that a pool has been returned has been omitted for brevity.

 // replace the '<mnemonic>' with the real account access code.
 const account = algosdk.mnemonicToSecretKey('<mnemonic>');

 // Remove 100,000 of the lp asset from the pool
const removeLiqTxGroup = await pools[0].prepareRemoveLiquidityTxGroup({
  address: account.addr,
  amount: 100_000,
});

// sign the transaction group and send it to algorand. Wait for the confirmation.
const signedAddLiqTx = addLiqTxGroup.signTxn(account.sk);
const sentAddLiqTx = await algod.sendRawTransaction(signedAddLiqTx).do();
await algosdk.waitForConfirmation(algod, sentAddLiqTx.txId, 2);
```
*
* ## Creating a swap.
```typescript
 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

 // Get the algorand and pact clients. token, url and port need to be filled in.
 const algod = new algosdk.Algodv2(token, url, port);
 const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});

 const algo = await pact.fetchAsset(0);
 // this is just a made up asset, replace it with the asset for the pool you want to interact with.
  const otherCoin = await pact.fetchAsset(8949213);
 const pools = await pact.fetchPoolsByAssets(algo, otherCoin)
// note checking that a pool has been returned has been omitted for brevity.

 // prepare the actual swap
 const swap = pool.prepareSwap({
  asset: algo,
  amount: 200_000,
  slippagePct: 2,
});

// Prepare the swap transactions.
const swapTxGroup = await swap.prepareTxGroup(account.addr);

// Sign the transaction group and send the transactions to algorand.
const signedTxs = swapTxGroup.signTxn(account.sk)
const tx = await algod.sendRawTransaction(signedTxs).do();
// wait for the transactions to be confirmed.
await algosdk.waitForConfirmation(algod, tx.txId, 2);
```
 */
export class Pool {
  /** Contains the code to do the math behind the pool. */
  calculator: PoolCalculator;

  /** Contains the current state of the pool. */
  state: PoolState;

  poolType: PoolType;

  params: ConstantProductPoolParams | StableswapPoolParams;

  feeBps: number;

  /**
   * Constructs a new pool.
   *
   * Pools are not meant to be created manually but instead are created as part of
   * fetching them using the [[PactClient]] class. The client class has code to fetch pools
   * by asset pair or by application id.
   *
   * @param algod the algorand client that this pool is created on.
   * @param appId the application id for the pool.
   * @param primaryAsset The primary asset for the pool.
   * @param secondaryAsset The secondary asset for the pool.
   * @param liquidityAsset The asset that is given to liquidity providers.
   * @param feeBps The fee in basis points for the pool.
   * @param internalState The current internal state for the pool.
   */
  constructor(
    protected algod: algosdk.Algodv2,
    public appId: number,
    public primaryAsset: Asset,
    public secondaryAsset: Asset,
    public liquidityAsset: Asset,
    public internalState: AppInternalState,
  ) {
    if (internalState.INITIAL_A !== undefined) {
      this.poolType = "STABLESWAP";
      this.params = {
        feeBps: internalState.FEE_BPS,
        pactFeeBps: internalState.PACT_FEE_BPS,
        initialA: internalState.INITIAL_A,
        initialATime: internalState.INITIAL_A_TIME,
        futureA: internalState.FUTURE_A,
        futureATime: internalState.FUTURE_A_TIME,
      };
    } else {
      this.poolType = "CONSTANT_PRODUCT";
      this.params = {
        feeBps: internalState.FEE_BPS,
      };
    }
    this.feeBps = internalState.FEE_BPS + (internalState.PACT_FEE_BPS ?? 0);
    this.calculator = new PoolCalculator(this);
    this.state = this.parseInternalState(this.internalState);
  }

  /**
   * Get the escrow address of the pool.
   *
   * @returns The address corresponding to that pools's escrow account.
   */
  getEscrowAddress() {
    return algosdk.getApplicationAddress(this.appId);
  }

  /**
   * Returns the "other" asset, i.e. primary if secondary is passed in and vice versa.
   *
   * @param asset the primary or secondary asset of the pool.
   * @returns the other asset, if the primary asset was passed in it will be the secondary asset and vice versa.
   * @throws Error if the asset passed in is not the primary or secondary asset.
   */
  getOtherAsset(asset: Asset): Asset {
    if (asset.index === this.primaryAsset.index) {
      return this.secondaryAsset;
    }
    if (asset.index === this.secondaryAsset.index) {
      return this.primaryAsset;
    }
    throw Error(`Asset with index ${asset.index} is not a pool asset.`);
  }

  /**
   * Reads the new pool state for the system and sets it to the internal state as well as returning it.
   *
   * Updating the pool state is recommended if there is a pause between the construction of the pool and
   * the creation of the transactions on the pool. Calling this function ensures that the
   * the pool state is not stale.
   *
   * @returns The new PoolState for the order.
   */
  async updateState(): Promise<PoolState> {
    this.internalState = await fetchAppState(this.algod, this.appId);
    this.state = this.parseInternalState(this.internalState);
    return this.state;
  }

  /**
    Prepares a [[TransactionGroup]] for adding liquidity to the pool. See [[Pool.buildAddLiquidityTxs]] for details.
   *
   * @param options Options for adding the liquidity.
   * @returns A transaction group that when executed will add liquidity to the pool.
   */
  async prepareAddLiquidityTxGroup(options: AddLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildAddLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  /**
   * Builds the transactions to add liquidity for the Primary Asset and Secondary Asset of the pool as per the options passed in.
   *
   * This method will generate the transactions that are needed to add the liquidity. You pass to the method an options structure with the
   * address of account to take the assets from, the amount of primary and secondary asset and an optional note to be included with the application
   * transaction.
   * In typical circumstances 3 transactions are generated:
   * - deposit of asset A
   * - deposit of asset B
   * - application call to add liquidity with the above deposits
   *
   * If the pool is empty and the product of both assets is larger then 2**64 then an additional set of 3 transactions is built.
   *
   * @param options the address and amounts to add to the pool.
   * @returns array of transactions to add the liquidity.
   */
  buildAddLiquidityTxs(options: AddLiquidityOptions & SuggestedParamsOption) {
    let txs: algosdk.Transaction[] = [];
    let { primaryAssetAmount, secondaryAssetAmount } = options;

    if (this.calculator.isEmpty) {
      // Adding initial liquidity has a limitation that the product of 2 assets must be lower then 2**64. Let's check if we can fit below the limit.
      const maxProduct = new D(2).pow(new D(64));
      const product = new D(primaryAssetAmount).mul(secondaryAssetAmount);
      if (product.gte(maxProduct)) {
        // Need to split the liquidity into two chunks.
        const divisor = new D(product).div(maxProduct).sqrt().add(1);
        const primarySmallAmount = new D(primaryAssetAmount)
          .div(divisor)
          .trunc()
          .toNumber();
        const secondarySmallAmount = new D(secondaryAssetAmount)
          .div(divisor)
          .trunc()
          .toNumber();

        primaryAssetAmount -= primarySmallAmount;
        secondaryAssetAmount -= secondarySmallAmount;

        txs = this.buildAddLiquidityTxs({
          ...options,
          primaryAssetAmount: primarySmallAmount,
          secondaryAssetAmount: secondarySmallAmount,
          note: encode("Initial add liquidity"),
        });
      }
    }

    const tx1 = this.makeDepositTx({
      address: options.address,
      asset: this.primaryAsset,
      amount: primaryAssetAmount,
      suggestedParams: options.suggestedParams,
    });
    const tx2 = this.makeDepositTx({
      address: options.address,
      asset: this.secondaryAsset,
      amount: secondaryAssetAmount,
      suggestedParams: options.suggestedParams,
    });
    const tx3 = this.makeApplicationNoopTx({
      address: options.address,
      suggestedParams: options.suggestedParams,
      fee: this.poolType === "CONSTANT_PRODUCT" ? 3000 : 7000,
      args: ["ADDLIQ", 0],
      extraAsset: this.liquidityAsset,
      note: options.note,
    });

    return [...txs, tx1, tx2, tx3];
  }

  /**
   * Prepares the transaction group for removing liquidity from the pool.
   *

   *
   * @param options The account address and amount of liquidity to remove.
   * @returns Transaction group that when executed will remove liquidity from the pool.
   */
  async prepareRemoveLiquidityTxGroup(options: RemoveLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildRemoveLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  /**
   * This creates two transactions in a group for the remove operation.
   * The first transaction deposits the liquidity asset from the account in the options.
   * The second transaction does a REMLIQ application transaction to remove the lp asset and receive the
   * calculated amount of the deposit and transaction
   *
   * @param options account address and amount of liquidity asset to return.
   * @returns
   */
  buildRemoveLiquidityTxs(
    options: RemoveLiquidityOptions & SuggestedParamsOption,
  ) {
    const txn1 = this.makeDepositTx({
      address: options.address,
      amount: options.amount,
      asset: this.liquidityAsset,
      suggestedParams: options.suggestedParams,
    });
    const txn2 = this.makeApplicationNoopTx({
      address: options.address,
      suggestedParams: options.suggestedParams,
      fee: 3000,
      args: ["REMLIQ", 0, 0], // min expected primary, min expected secondary
    });

    return [txn1, txn2];
  }

  /**
   * Generate a swap class to swap to receive an amount of asset from this pool upto a slippage percentage.
   * @param options options for the swap including asset to receive and amount of asset and maximum slippage.
   * @returns a new swap object.
   * @throws Error if the Asset in the swap options is not in the pool.
   */
  prepareSwap(options: SwapOptions): Swap {
    if (!this.isAssetInThePool(options.asset)) {
      throw `Asset ${options.asset.index} not in the pool`;
    }
    return new Swap(
      this,
      options.asset,
      options.amount,
      options.slippagePct,
      !!options.reverse,
    );
  }

  /**
   * Check if the asset is the primary or secondary asset of this pool.
   *
   * @param asset the asset to check is in the pool
   * @returns true if the asset is in the pool or false otherwise
   */
  isAssetInThePool(asset: Asset) {
    return [this.primaryAsset.index, this.secondaryAsset.index].includes(
      asset.index,
    );
  }

  /**
   * Transaction group that when executed will perform a swap that will receive the amount of asset into
   * the account address.
   *
   * @param options swap options and account address
   * @returns transaction group that will perform the swap to receive the asset.
   */
  async prepareSwapTxGroup(options: SwapTxOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildSwapTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  /**
   * Builds the two transactions, a deposit and an application transaction, necessary for
   * making a swap. Clients should use [[prepareSwapTxGroup]] to build the transaction group.
   *
   * @param options the address and swap details to create the transactions for
   * @returns an array fo transactions.
   */
  buildSwapTxs({
    address,
    swap,
    suggestedParams,
  }: SwapTxOptions & SuggestedParamsOption) {
    const txn1 = this.makeDepositTx({
      address,
      amount: swap.effect.amountDeposited,
      asset: swap.assetDeposited,
      suggestedParams,
    });
    const txn2 = this.makeApplicationNoopTx({
      address,
      suggestedParams,
      fee: this.poolType === "CONSTANT_PRODUCT" ? 2000 : 7000,
      args: ["SWAP", swap.effect.minimumAmountReceived],
    });

    return [txn1, txn2];
  }

  /**
   * Transaction for depositing an asset from the account to the pool.
   *
   * @param options options for transferring asset from the account to the pool escrow address.
   * @returns transaction
   */
  private makeDepositTx(options: MakeDepositTxOptions) {
    if (!options.asset.index) {
      // ALGO
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: options.address,
        to: this.getEscrowAddress(),
        amount: BigInt(options.amount),
        suggestedParams: options.suggestedParams,
      });
    }
    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: options.address,
      to: this.getEscrowAddress(),
      amount: BigInt(options.amount),
      assetIndex: options.asset.index,
      suggestedParams: options.suggestedParams,
    });
  }

  /**
   * Create an application transaction on the pool address.
   *
   * @param options options for the application transaction
   * @returns a transaction.
   */
  private makeApplicationNoopTx(options: MakeNoopTxOptions) {
    const appArgs = encodeArray(options.args);

    const foreignAssets = [this.primaryAsset.index, this.secondaryAsset.index];
    if (options.extraAsset) {
      foreignAssets.push(options.extraAsset.index);
    }

    return algosdk.makeApplicationNoOpTxnFromObject({
      from: options.address,
      appIndex: this.appId,
      foreignAssets,
      appArgs,
      suggestedParams: {
        ...options.suggestedParams,
        fee: options.fee,
        flatFee: true,
      },
      note: options.note,
    });
  }

  /**
   * Read the new pool state from the global state of the application.
   *
   * @param state internal state for the application
   * @returns returns a PoolState
   */
  private parseInternalState(state: AppInternalState): PoolState {
    return {
      totalLiquidity: state.L,
      totalPrimary: state.A,
      totalSecondary: state.B,
      primaryAssetPrice: this.calculator.primaryAssetPrice,
      secondaryAssetPrice: this.calculator.secondaryAssetPrice,
    };
  }
}
