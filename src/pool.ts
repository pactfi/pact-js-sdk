/**
 * @fileoverview Contains functions and classes that allow access information about or interacting with a Pact AMM Liquidity Pool.
 *
 * The main element is the Pool class which contains functions for adding and removing liquidity from the pool
 *
 * @package
 */
import algosdk from "algosdk";
import D from "decimal.js";

import { listPools } from "./api";
import { Asset, fetchAssetByIndex } from "./asset";
import { encode, encodeArray } from "./encoding";
import { isqrt } from "./isqrt";
import { PoolCalculator } from "./poolCalculator";
import { AppInternalState, PoolState, parseGlobalPoolState } from "./poolState";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";

/**
 * The arguments to add liquidity to the pool.
 *
 */
export type AddLiquidityOptions = {
  /** Account address that will deposit the primary and secondary assets and receive the LP token. */
  address: string;

  /** The amount of primary asset to deposit. */
  primaryAssetAmount: number;

  /** The amount of secondary asset to deposit. */
  secondaryAssetAmount: number;

  /** An optional note that can be added to the application ADDLIQ transaction. */
  note?: Uint8Array;
};

/** The arguments for removing liquidity from the pool. */
export type RemoveLiquidityOptions = {
  /** Account address that will return the LP token and receive the primary and secondary assets. */
  address: string;

  /** The amount of the LP token to return to the pool. */
  amount: number;
};

/**
 * Options for creating a [[Swap]].
 */
export type SwapOptions = {
  /** The asset to swap. */
  asset: Asset;

  /** Amount to swap or to receive. Look at `swapForExact` flag for details. */
  amount: number;

  /** The maximum allowed slippage in percents e.g. `10` is 10%. The swap will fail if slippage will be higher. */
  slippagePct: number;

  /**
   * If false or not provided, the `amount` is the amount to swap (deposit in the contract).
   * If true, the `amount` is the amount to receive from the swap.
   */
  swapForExact?: boolean;
};

/** The arguments used to generate the swap. */
export type SwapTxOptions = {
  swap: Swap;
  address: string;
};

export type PoolType = "CONSTANT_PRODUCT" | "STABLESWAP";

/**
 * The basic three operation types in a PACT liquidity pool, namely Add Liquidity (ADDLIQ), Remove Liquidity (REMLIQ) and making a swap (SWAP).
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
 * Fetches the global state of the of an application.
 *
 * @param algod The algo client to query the app in.
 * @param appId The application id to fetch the state of.
 *
 * @returns The global state of the application.
 */
export async function fetchAppGlobalState(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<AppInternalState> {
  const appData = await algod.getApplicationByID(appId).do();
  return parseGlobalPoolState(appData.params["global-state"]);
}

/**
 * Fetches the pool from the blockchain using the provided algod client.
 *
 * @param algod The algo client to use.
 * @param appId The application id to fetch.
 *
 * @returns The pool object for the application id passed in.
 */
export async function fetchPoolById(algod: algosdk.Algodv2, appId: number) {
  const appState = await fetchAppGlobalState(algod, appId);

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
 * Returns the list of [[Pool]] for the assets passed in.
 * There can be zero pools if there are no pools matching the assets, or multiple if there are multiple at different fees.
 * The order of assets that you provide is irrelevant.
 *
 * @param algod The algo client to use.
 * @param assetA One of the assets in the pool (asset id or [[Asset]]).
 * @param assetB The other asset in the pool (asset id or [[Asset]]).
 * @param pactApiUrl The API url to use.
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
 * This function finds any pools using the `pactApiUrl` passed in that match the asset ids passed in.
 *
 * @param pactApiUrl The API url to use.
 * @param primaryAssetIndex The algorand asset id for the primary asset of the pool.
 * @param secondaryAssetIndex The algorand asset id for the secondary asset of the pool.
 *
 * @returns Array of asset ids.
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
 * Typically, users don't have to instantiate this class manually. Use [[PactClient.fetchPoolById]] or [[PactClient.fetchPoolsByAssets]] instead.
 *
 * The primary methods of the pool are to create the transaction groups to enable you to
 * * Add Liquidity,
 * * Removing Liquidity,
 * * Create a Swap on the Pool.
 */
export class Pool {
  /**
   * The Algorand client to use.
   */
  algod: algosdk.Algodv2;

  /**
   * The application id for the pool.
   */
  appId: number;

  /**
   * The asset of the liquidity pool with the lower index.
   */
  primaryAsset: Asset;

  /**
   * The asset of the liquidity pool with the higher index.
   */
  secondaryAsset: Asset;

  /**
   * The asset for the liquidity pool token (LP token) that is given when liquidity is added, and burned when liquidity is withdrawn.
   */
  liquidityAsset: Asset;

  /**
   * The global state on the blockchain for this pool.
   */
  internalState: AppInternalState;

  /** Contains the code to do the math behind the pool. */
  calculator: PoolCalculator;

  /** Contains the current state of the pool. */
  state: PoolState;

  /** Different pool types use different formulas for making swaps. */
  poolType: PoolType;

  params: ConstantProductPoolParams | StableswapPoolParams;

  /** The fee in basis points for swaps trading on the pool. */
  feeBps: number;

  /**
   * Constructs a new pool.
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
    algod: algosdk.Algodv2,
    appId: number,
    primaryAsset: Asset,
    secondaryAsset: Asset,
    liquidityAsset: Asset,
    internalState: AppInternalState,
  ) {
    this.algod = algod;
    this.appId = appId;
    this.primaryAsset = primaryAsset;
    this.secondaryAsset = secondaryAsset;
    this.liquidityAsset = liquidityAsset;
    this.internalState = internalState;

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
   * @param asset The primary or secondary asset of the pool.
   *
   * @throws Error if the asset passed in is not the primary or secondary asset.
   *
   * @returns The other asset, if the primary asset was passed in it will be the secondary asset and vice versa.
   *
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
   * Updates the internal and pool state properties by re-reading the global state in the blockchain.
   *
   * Updating the pool state is recommended if there is a pause between the construction of the pool and the creation of the transactions on the pool. Calling this method ensures that the the pool state is not stale.
   *
   * @returns The new pool state.
   */
  async updateState(): Promise<PoolState> {
    this.internalState = await fetchAppGlobalState(this.algod, this.appId);
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
   * Builds the transactions to add liquidity for the primary asset and secondary asset of the pool as per the options passed in.
   *
   * In typical circumstances 3 transactions are generated:
   * - deposit of asset A
   * - deposit of asset B
   * - "ADDLIQ" application call to add liquidity with the above deposits
   *
   * If the pool is empty and the product of both assets is larger then 2**64 then an additional set of 3 transactions is built.
   *
   * The initial liquidity must satisfy the expression `sqrt(a * b) - 1000 < 0`.
   *
   * @param options Options for adding the liquidity.
   *
   * @throws Error if initial liquidity is too low.
   *
   * @returns Array of transactions to add the liquidity.
   */
  buildAddLiquidityTxs(options: AddLiquidityOptions & SuggestedParamsOption) {
    let txs: algosdk.Transaction[] = [];
    let { primaryAssetAmount, secondaryAssetAmount } = options;

    if (this.calculator.isEmpty) {
      const aLiq = BigInt(options.primaryAssetAmount);
      const bLiq = BigInt(options.secondaryAssetAmount);
      if (isqrt(aLiq * bLiq) - 1000n <= 0) {
        throw Error(
          "Initial liquidity must satisfy the expression `sqrt(a * b) - 1000 < 0`",
        );
      }

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
   * @param options Options for removing the liquidity.
   *
   * @returns Transaction group that when executed will remove liquidity from the pool.
   */
  async prepareRemoveLiquidityTxGroup(options: RemoveLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildRemoveLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  /**
   * This creates two transactions in a group for the remove operation.
   * - deposit of the liquidity asset
   * - "REMLIQ" application call to remove the LP token from the account and receive the deposited assets in return
   *
   * @param options Options for removing the liquidity.
   *
   * @returns Array of transactions to remove the liquidity.
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
   * Creates a new swap instance for receiving the amount of asset within the slippage percent from the pool.
   *
   * @param options Swap options.
   *
   * @throws Error if the Asset in the swap options is not in the pool.
   *
   * @returns A new swap object.
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
      !!options.swapForExact,
    );
  }

  /**
   * Check if the asset is the primary or secondary asset of this pool.
   *
   * @param asset The asset to check is in the pool.
   *
   * @returns True if the asset is in the pool or false otherwise.
   */
  isAssetInThePool(asset: Asset) {
    return [this.primaryAsset.index, this.secondaryAsset.index].includes(
      asset.index,
    );
  }

  /**
   * Prepares a transaction group that when executed will perform a swap on the pool.
   *
   * @param options Swap options.
   *
   * @returns Transaction group that when executed will perform a swap on the pool.
   */
  async prepareSwapTxGroup(options: SwapTxOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildSwapTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  /**
   * Builds two transactions:
   * - deposit of the asset to swap
   * - "SWAP' application call that performs the swap to receive the other asset
   *
   * @param options Swap options.
   *
   * @returns Array of transactions to perform the swap.
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
   * @param state Global state for the application.
   *
   * @returns Parsed state.
   */
  parseInternalState(state: AppInternalState): PoolState {
    return {
      totalLiquidity: state.L,
      totalPrimary: state.A,
      totalSecondary: state.B,
      primaryAssetPrice: this.calculator.primaryAssetPrice,
      secondaryAssetPrice: this.calculator.secondaryAssetPrice,
    };
  }
}
