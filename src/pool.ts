/**
 * @fileoverview Contains functions and classes that allow access information about or interacting with a Pact AMM Liquidity Pool.
 *
 * The main element is the Pool class which contains functions for adding and removing liquidity from the pool
 *
 * @package
 */
import algosdk, { SuggestedParams } from "algosdk";

import { LiquidityAddition } from "./addLiquidity";
import { listPools } from "./api";
import { Asset, fetchAssetByIndex } from "./asset";
import { encode, encodeArray } from "./encoding";
import { PactSdkError } from "./exceptions";
import { isqrt } from "./isqrt";
import { PoolCalculator } from "./poolCalculator";
import {
  AppInternalState,
  PoolState,
  getPoolTypeFromInternalState,
  parseGlobalPoolState,
} from "./poolState";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";
import { spFee } from "./utils";
import { Zap } from "./zap";

/**
 * The arguments to add liquidity to the pool.
 *
 */
export type AddLiquidityOptions = {
  /** The amount of primary asset to deposit. */
  primaryAssetAmount: number;

  /** The amount of secondary asset to deposit. */
  secondaryAssetAmount: number;

  /** The maximum allowed slippage in percents e.g. `10` is 10%. Adding liquidity will fail if slippage will be higher. */
  slippagePct: number;
};

export type AddLiquidityTxOptions = {
  liquidityAddition: LiquidityAddition;

  /** Account address that will deposit the primary and secondary assets and receive the LP token. */
  address: string;
};

export type RawAddLiquidityTxOptions = AddLiquidityOptions & {
  /** Account address that will deposit the primary and secondary assets and receive the LP token. */
  address: string;

  /** The transaction fee of the app call. */
  fee: number;

  /**
   * Amount of minimum liquidity tokens received. The transaction will fail if the real value will be lower than this.
   */
  minimumMintedLiquidityTokens: number;

  suggestedParams: SuggestedParams;

  /** An optional note that can be added to the application ADDLIQ transaction. */
  note?: Uint8Array;
};

/** The arguments to add liquidity to the pool using zap. */
export type ZapOptions = {
  /** Asset provided for the zap. */
  asset: Asset;

  /** Amount used for the zap. */
  amount: number;

  /** The maximum allowed slippage in percents e.g. `10` is 10%. The swap will fail if slippage will be higher. */
  slippagePct: number;
};

/** The options for building zap transactions. */
export type ZapTxOptions = {
  zap: Zap;
  address: string;
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

export type PoolType =
  | "CONSTANT_PRODUCT"
  | "STABLESWAP"
  | "NFT_CONSTANT_PRODUCT";

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
  note: Uint8Array;
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
    primary_asset__on_chain_id: primaryAssetIndex.toString(),
    secondary_asset__on_chain_id: secondaryAssetIndex.toString(),
  });
  return data.results.map((pool) => parseInt(pool.on_chain_id));
}

export type ConstantProductPoolParams = {
  feeBps: number;
  pactFeeBps: number;
};

export type StableswapPoolParams = {
  feeBps: number;
  pactFeeBps: number;
  initialA: number;
  initialATime: number;
  futureA: number;
  futureATime: number;
  precision: number;
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

  /**
   * Contains the code to do the math behind the pool.
   */
  calculator: PoolCalculator;

  /**
   * Contains the current state of the pool.
   */
  state: PoolState;

  /**
   * Different pool types use different formulas for making swaps.
   */
  poolType: PoolType;

  params: ConstantProductPoolParams | StableswapPoolParams;

  /**
   * The fee in basis points for swaps trading on the pool.
   */
  feeBps: number;

  /**
   * The version of the contract. May be 0 for some old pools which don't expose the version in the global state.
   */
  version: number;

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

    this.poolType = getPoolTypeFromInternalState(internalState);

    if (
      this.poolType === "CONSTANT_PRODUCT" ||
      this.poolType === "NFT_CONSTANT_PRODUCT"
    ) {
      this.params = {
        feeBps: internalState.FEE_BPS,
        pactFeeBps: internalState.PACT_FEE_BPS ?? 0,
      };
    } else if (this.poolType === "STABLESWAP") {
      this.params = {
        feeBps: internalState.FEE_BPS,
        pactFeeBps: internalState.PACT_FEE_BPS ?? 0,
        initialA: internalState.INITIAL_A,
        initialATime: internalState.INITIAL_A_TIME,
        futureA: internalState.FUTURE_A,
        futureATime: internalState.FUTURE_A_TIME,
        precision: internalState.PRECISION,
      };
    } else {
      throw new PactSdkError(`Unknown pool type "${this.poolType}".`);
    }

    this.feeBps = internalState.FEE_BPS;
    this.calculator = new PoolCalculator(this);
    this.state = this.parseInternalState(this.internalState);
    this.version = internalState.VERSION ?? 0;
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
   * @throws PactSdkError if the asset passed in is not the primary or secondary asset.
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
    throw new PactSdkError(
      `Asset with index ${asset.index} is not a pool asset.`,
    );
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
   * Creates a new LiquidityAddition instance.
   *
   * @param options Options for adding the liquidity.
   *
   * @returns A new LiquidityAddition object.
   */
  prepareAddLiquidity(options: AddLiquidityOptions): LiquidityAddition {
    return new LiquidityAddition(
      this,
      options.primaryAssetAmount,
      options.secondaryAssetAmount,
      options.slippagePct,
    );
  }

  /**
    Prepares a [[TransactionGroup]] for adding liquidity to the pool. See [[Pool.buildAddLiquidityTxs]] for details.
   *
   * @param options Options for adding the liquidity.
   *
   * @returns A transaction group that when executed will add liquidity to the pool.
   */
  async prepareAddLiquidityTxGroup(options: AddLiquidityTxOptions) {
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
   * The initial liquidity must satisfy the expression `sqrt(a * b) - 1000 > 0`.
   *
   * @param options Options for adding the liquidity.
   *
   * @throws PactSdkError if initial liquidity is too low.
   *
   * @returns Array of transactions to add the liquidity.
   */
  buildAddLiquidityTxs(options: AddLiquidityTxOptions & SuggestedParamsOption) {
    const { liquidityAddition } = options;
    const { primaryAssetAmount, secondaryAssetAmount } = liquidityAddition;

    if (this.calculator.isEmpty) {
      const aLiq = BigInt(primaryAssetAmount);
      const bLiq = BigInt(secondaryAssetAmount);
      if (isqrt(aLiq * bLiq) - 1000n <= 0) {
        throw new PactSdkError(
          "Initial liquidity must satisfy the expression `sqrt(a * b) - 1000 > 0`",
        );
      }
    }

    return this.buildRawAddLiquidityTxs({
      address: options.address,
      fee: liquidityAddition.effect.txFee,
      primaryAssetAmount,
      secondaryAssetAmount,
      slippagePct: liquidityAddition.slippagePct,
      minimumMintedLiquidityTokens:
        liquidityAddition.effect.minimumMintedLiquidityTokens,
      suggestedParams: options.suggestedParams,
    });
  }

  private buildRawAddLiquidityTxs(options: RawAddLiquidityTxOptions) {
    const tx1 = this.makeDepositTx({
      address: options.address,
      asset: this.primaryAsset,
      amount: options.primaryAssetAmount,
      note: encode("Pact add liquidity deposit"),
      suggestedParams: options.suggestedParams,
    });
    const tx2 = this.makeDepositTx({
      address: options.address,
      asset: this.secondaryAsset,
      amount: options.secondaryAssetAmount,
      note: encode("Pact add liquidity deposit"),
      suggestedParams: options.suggestedParams,
    });
    const tx3 = this.makeApplicationNoopTx({
      address: options.address,
      suggestedParams: options.suggestedParams,
      fee: options.fee,
      args: ["ADDLIQ", options.minimumMintedLiquidityTokens],
      extraAsset: this.liquidityAsset,
      note: options.note,
    });

    return [tx1, tx2, tx3];
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
      note: encode("Pact remove liquidity deposit"),
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
   * @throws PactSdkError if the asset is not in the pool.
   * @throws SwapValidationError if slippage is outside of bounds [0, 100].
   * @throws SwapValidationError if pool is empty.
   * @throws LiquiditySurpassedError if `swapForExact` flag is enabled and tried to swap for more then current liquidity allows.
   *
   * @returns A new swap object.
   */
  prepareSwap(options: SwapOptions): Swap {
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
      note: encode("Pact swap deposit"),
      suggestedParams,
    });
    const txn2 = this.makeApplicationNoopTx({
      address,
      suggestedParams,
      fee: swap.effect.txFee,
      args: ["SWAP", swap.effect.minimumAmountReceived],
    });

    return [txn1, txn2];
  }

  /**
   * Creates a new zap instance for getting all required data for performing a zap.
   *
   * @param options Zap options.
   *
   * @throws PactSdkError if the asset is not in the pool or if the pool is a Stableswap type.
   *
   * @returns A new zap object.
   */
  prepareZap(options: ZapOptions): Zap {
    return new Zap(this, options.asset, options.amount, options.slippagePct);
  }

  /**
    Prepares a [[TransactionGroup]] for performing a Zap on the pool. See [[Pool.buildZapTxs]] for details.
   *
   * @param options Options for Zap.
   *
   * @returns A transaction group that when executed will add liquidity to the pool by getting only one amount.
   */
  async prepareZapTxGroup(options: ZapTxOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildZapTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  /**
   * Builds the transactions to perform a Zap on the pool as per the options passed in. Zap allows to add liquidity to the pool by providing only one asset.
   *
   * This function will generate swap Txs to get a proper amount of the second asset and then generate add liquidity Txs with both of those assets.
   * See [[Pool.buildSwapTxs]] and [[Pool.buildAddLiquidityTxs]] for more details.
   *
   * This feature is supposed to work with constant product pools only. Stableswaps can accept one asset to add liquidity by default.
   *
   * @param options Options for building Zap txs.
   *
   * @returns Array of transactions to swap & add liquidity.
   */
  buildZapTxs({
    address,
    zap,
    suggestedParams,
  }: ZapTxOptions & SuggestedParamsOption) {
    const { swap, liquidityAddition } = zap;

    const swapTxs = this.buildSwapTxs({
      address: address,
      swap,
      suggestedParams,
    });
    const addLiqTxs = this.buildAddLiquidityTxs({
      address: address,
      liquidityAddition,
      suggestedParams,
    });
    return [...swapTxs, ...addLiqTxs];
  }

  private makeDepositTx(options: MakeDepositTxOptions) {
    if (!options.asset.index) {
      // ALGO
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: options.address,
        to: this.getEscrowAddress(),
        amount: BigInt(options.amount),
        note: options.note,
        suggestedParams: options.suggestedParams,
      });
    }
    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: options.address,
      to: this.getEscrowAddress(),
      amount: BigInt(options.amount),
      assetIndex: options.asset.index,
      note: options.note,
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
      suggestedParams: spFee(options.suggestedParams, options.fee),
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
