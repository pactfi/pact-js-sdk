import algosdk from "algosdk";

import { LiquidityAddition } from "./addLiquidity";
import { Asset, fetchAssetByIndex } from "./asset";
import { PactSdkError } from "./exceptions";
import {
  AddLiquidityOptions,
  Pool,
  RemoveLiquidityOptions,
  SuggestedParamsOption,
  SwapOptions,
} from "./pool";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";
import { parseState, spFee } from "./utils";

const PRE_ADD_LIQUIDITY_SIG = new Uint8Array([200, 101, 138, 92]);
const ADD_LIQUIDITY_SIG = new Uint8Array([234, 209, 248, 201]);
const REMOVE_LIQUIDITY_SIG = new Uint8Array([95, 219, 213, 93]);
const POST_REMOVE_LIQUIDITY_SIG = new Uint8Array([244, 59, 238, 97]);
const SWAP_SIG = new Uint8Array([247, 180, 116, 86]);
const OPT_IN_SIG = new Uint8Array([133, 14, 253, 26]);

const ABI_BYTE = new algosdk.ABIUintType(8);

// call(1000) + 2 * wrap(4000) + refund(1000)
const PRE_ADD_LIQ_FEE = 10_000;

// call(1000) + 2 * wrap(4000)
const ADD_LIQ_FEE = 9000;

// call(1000) + transfer_PLP(1000) + rem_liq(3000)
const REM_LIQ_FEE = 5000;

// call(1000) + 2 * unwrap(5000) + 2 * transfer_asset(1000)
const POST_REM_LIQ_FEE = 13_000;

// call(1000) + wrap(4000) + swap(3000) + unwrap(5000) + transfer_asset(1000)
const SWAP_FEE = 14_000;

const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
const ONE_14_DP = 1e14;
const ONE_16_DP = 1e16;

export type AddLendingLiquidityTxOptions = {
  liquidityAddition: LendingLiquidityAddition;

  /** Account address that will deposit the primary and secondary assets and receive the LP token. */
  address: string;
};

export type OptInAssetToAdapterTxOptions = {
  address: string;
  assetIds: number[];
};

/**
 * A wrapper around Swap object that adds some lending specific information.
 */
export type LendingSwap = {
  /**
   * Information about the actual swap on the Pact pool.
   */
  fSwap: Swap;

  assetDeposited: Asset;
  assetReceived: Asset;

  /**
   * Amount of original asset deposited by the user.
   */
  amountDeposited: number;

  /**
   * Amount of original asset received by the user.
   */
  amountReceived: number;

  /**
   * Minimal amount of original asset received by the user after the slippage.
   */
  minimumAmountReceived: number;

  txFee: number;
};

export type LendingSwapTxOptions = {
  swap: LendingSwap;
  address: string;
};

export class FolksLendingPool {
  escrowAddress: string;

  /** The conversion calculations are dependant of precise timestamps. The Folks contract uses the last block timestamp for this value. The SDK, by default, uses current system time. This field allows to override the default behavior. This is needed in unit tests and normal users should leave this field as null. */
  lastTimestamp: number | null = null;

  constructor(
    public algod: algosdk.Algodv2,
    public appId: number,
    public managerAppId: number,
    public depositInterestRate: number,
    public depositInterestIndex: number,
    public updatedAt: Date,
    public originalAsset: Asset,
    public fAsset: Asset,
  ) {
    this.escrowAddress = algosdk.getApplicationAddress(this.appId);
  }

  private calcDepositInterestRate(timestamp: number): number {
    const dt = Math.floor(
      timestamp - Math.floor(this.updatedAt.getTime() / 1000),
    );
    return Math.floor(
      (this.depositInterestIndex *
        Math.floor(
          ONE_16_DP + (this.depositInterestRate * dt) / SECONDS_IN_YEAR,
        )) /
        ONE_16_DP,
    );
  }

  /**
   * Calculates the amount fAsset received when depositing original asset.
   */
  convertDeposit(amount: number): number {
    const rate = this.calcDepositInterestRate(this.getLastTimestamp());
    return Math.floor((amount * ONE_14_DP) / rate);
  }

  /**
   * Calculates the amount original asset received when depositing fAsset.
   */
  convertWithdraw(amount: number, options: { ceil?: boolean } = {}): number {
    const rate = this.calcDepositInterestRate(this.getLastTimestamp());
    const converted = (amount * rate) / ONE_14_DP;
    if (options.ceil) {
      return Math.ceil(converted);
    }
    return Math.floor(converted);
  }

  getLastTimestamp(): number {
    return this.lastTimestamp ?? Math.floor(new Date().getTime() / 1000);
  }
}

/**
 * Fetches Folks lending pool application info from the algod, parses the global state and builds FolksLendingPool object.
 */
export async function fetchFolksLendingPool(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<FolksLendingPool> {
  const appInfo = await algod.getApplicationByID(appId).do();
  const rawState = appInfo["params"]["global-state"];
  const state = parseState(rawState);

  const managerAppId = Number(
    Buffer.from(state["pm"], "base64").readBigUInt64BE(0),
  );

  const assetsIds = Buffer.from(state["a"], "base64");

  const originalAssetId = Number(assetsIds.readBigUInt64BE(0));
  const fAssetId = Number(assetsIds.readBigUInt64BE(8));

  const interestInfo = Buffer.from(state["i"], "base64");

  const depositInterestRate = Number(interestInfo.readBigUInt64BE(32));
  const depositInterestIndex = Number(interestInfo.readBigUInt64BE(40));
  const updatedAt = Number(interestInfo.readBigUInt64BE(48));

  const [originalAsset, fAsset] = await Promise.all([
    fetchAssetByIndex(algod, originalAssetId),
    fetchAssetByIndex(algod, fAssetId),
  ]);

  return new FolksLendingPool(
    algod,
    appId,
    managerAppId,
    depositInterestRate,
    depositInterestIndex,
    new Date(updatedAt * 1000),
    originalAsset,
    fAsset,
  );
}

/**
 * A wrapper around LiquidityAddition object that converts assets to fAssets before creating LiquidityAddition object.
 */
export class LendingLiquidityAddition {
  /**
   * Information about actual add liquidity operation on the Pact pool.
   */
  public liquidityAddition: LiquidityAddition;

  constructor(
    public lendingPoolAdapter: FolksLendingPoolAdapter,
    public primaryAssetAmount: number,
    public secondaryAssetAmount: number,
  ) {
    this.liquidityAddition = new LiquidityAddition(
      this.lendingPoolAdapter.pactPool,
      this.lendingPoolAdapter.primaryLendingPool.convertDeposit(
        this.primaryAssetAmount,
      ),
      this.lendingPoolAdapter.secondaryLendingPool.convertDeposit(
        this.secondaryAssetAmount,
      ),
    );
    this.liquidityAddition.effect.txFee = PRE_ADD_LIQ_FEE + ADD_LIQ_FEE;
  }
}

/**
The representation of the Folks Finance lending adapter contract.

This class allows for composing Pact swaps and adding/removing liquidity with Folks Finance lending pools, resulting in a higher APR for liquidity providers that accommodates both, the trading APR and the lending APR.

The user is not interacting with Folks Finance pools or Pact pools directly. Instead, the user is calling a global adapter contract that makes inner transactions to the other applications.

The Pact pool is between two fAssets e.g. fALGO and fUSDC but the user doesn't have to be opted into those fAssets. The user interacts only with ALGO and USDC. Converting between the original assets and fAssets is hidden in the adapter contract.

To add liquidity:
 - The user deposits ALGO and USDC in the adapter contract.
 - The user calls “pre_add_liquidity” method on the adapter.
 - The adapter converts ALGO to fALGO and USDC to fUSDC in corresponding Folks Finance pools.
 - The user calls “add_liquidity” method on the adapter.
 - The adapter deposits fALGO and fUSDC in Pact pool and receives liquidity tokens in return.
 - The adapter transfers the liquidity tokens to the user.

To remove liquidity:
 - The user deposits liquidity tokens in the adapter contract.
 - The user calls “remove_liquidity” method on the adapter.
 - The adapter removes liquidity from the Pact pool and receives fALGO and fUSDC in return.
 - The user calls “post_remove_liquidity” method on the adapter.
 - The adapter converts fALGO to ALGO and fUSDC to USDC in corresponding Folks Finance pools.
 - The adapter transfers ALGO and USDC tokens to the user.

For swap:
 - The user deposits one of the assets in the adapter e.g. USDC.
 - The user calls “swap” method on the adapter.
 - The adapter converts USDC to fUSDC in a corresponding Folks Finance pool.
 - The adapter swaps fUSDC to fALGO in a Pact pool.
 - The adapter converts fALGO to ALGO in a corresponding Folks Finance pool.
 - The adapter transfers ALGO to the user.

This class tries to mimic the interface of a [[Pool]] for making the above operations.
 */
export class FolksLendingPoolAdapter {
  public escrowAddress: string;

  constructor(
    public algod: algosdk.Algodv2,
    public appId: number,
    public pactPool: Pool,
    public primaryLendingPool: FolksLendingPool,
    public secondaryLendingPool: FolksLendingPool,
  ) {
    this.escrowAddress = algosdk.getApplicationAddress(this.appId);
    if (
      this.pactPool.primaryAsset.index !==
        this.primaryLendingPool.fAsset.index ||
      this.pactPool.secondaryAsset.index !==
        this.secondaryLendingPool.fAsset.index
    ) {
      throw new PactSdkError(
        "Assets between Folks lending pools and Pact pool do not match.",
      );
    }

    if (
      this.primaryLendingPool.managerAppId !==
      this.secondaryLendingPool.managerAppId
    ) {
      throw new PactSdkError(
        "Manager app of the Folks lending pools do not match.",
      );
    }
  }

  originalAssetToFAsset(originalAsset: Asset): Asset {
    const assetsMap = {
      [this.primaryLendingPool.originalAsset.index]:
        this.primaryLendingPool.fAsset,
      [this.secondaryLendingPool.originalAsset.index]:
        this.secondaryLendingPool.fAsset,
    };
    return assetsMap[originalAsset.index];
  }

  fAssetToOriginalAsset(fAsset: Asset): Asset {
    const assetsMap = {
      [this.primaryLendingPool.fAsset.index]:
        this.primaryLendingPool.originalAsset,
      [this.secondaryLendingPool.fAsset.index]:
        this.secondaryLendingPool.originalAsset,
    };
    return assetsMap[fAsset.index];
  }

  prepareAddLiquidity(options: AddLiquidityOptions): LendingLiquidityAddition {
    return new LendingLiquidityAddition(
      this,
      options.primaryAssetAmount,
      options.secondaryAssetAmount,
    );
  }

  async prepareAddLiquidityTxGroup(
    options: AddLendingLiquidityTxOptions,
  ): Promise<TransactionGroup> {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildAddLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildAddLiquidityTxs(
    options: AddLendingLiquidityTxOptions & SuggestedParamsOption,
  ): algosdk.Transaction[] {
    const tx1 = this.primaryLendingPool.originalAsset.buildTransferTx(
      options.address,
      this.escrowAddress,
      options.liquidityAddition.primaryAssetAmount,
      options.suggestedParams,
    );

    const tx2 = this.secondaryLendingPool.originalAsset.buildTransferTx(
      options.address,
      this.escrowAddress,
      options.liquidityAddition.secondaryAssetAmount,
      options.suggestedParams,
    );

    const tx3 = algosdk.makeApplicationNoOpTxnFromObject({
      from: options.address,
      suggestedParams: spFee(options.suggestedParams, PRE_ADD_LIQ_FEE),
      appIndex: this.appId,
      appArgs: [
        PRE_ADD_LIQUIDITY_SIG,
        //assets
        ABI_BYTE.encode(0),
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        ABI_BYTE.encode(3),
        //apps
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        ABI_BYTE.encode(3),
        ABI_BYTE.encode(4),
      ],
      foreignAssets: [
        this.primaryLendingPool.originalAsset.index,
        this.secondaryLendingPool.originalAsset.index,
        this.primaryLendingPool.fAsset.index,
        this.secondaryLendingPool.fAsset.index,
      ],
      foreignApps: [
        this.primaryLendingPool.appId,
        this.secondaryLendingPool.appId,
        this.primaryLendingPool.managerAppId,
        this.pactPool.appId,
      ],
    });

    const tx4 = algosdk.makeApplicationNoOpTxnFromObject({
      from: options.address,
      suggestedParams: spFee(options.suggestedParams, ADD_LIQ_FEE),
      appIndex: this.appId,
      appArgs: [
        ADD_LIQUIDITY_SIG,
        //assets
        ABI_BYTE.encode(0),
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        // pact pool id
        ABI_BYTE.encode(1),
        // min expected
        ABI_BYTE.encode(0),
      ],
      foreignAssets: [
        this.primaryLendingPool.fAsset.index,
        this.secondaryLendingPool.fAsset.index,
        this.pactPool.liquidityAsset.index,
      ],
      foreignApps: [this.pactPool.appId],
    });

    return [tx1, tx2, tx3, tx4];
  }

  async prepareRemoveLiquidityTxGroup(
    options: RemoveLiquidityOptions,
  ): Promise<TransactionGroup> {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildRemoveLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildRemoveLiquidityTxs(
    options: RemoveLiquidityOptions & SuggestedParamsOption,
  ): algosdk.Transaction[] {
    const tx1 = this.pactPool.liquidityAsset.buildTransferTx(
      options.address,
      this.escrowAddress,
      options.amount,
      options.suggestedParams,
    );

    const tx2 = algosdk.makeApplicationNoOpTxnFromObject({
      from: options.address,
      suggestedParams: spFee(options.suggestedParams, REM_LIQ_FEE),
      appIndex: this.appId,
      appArgs: [
        REMOVE_LIQUIDITY_SIG,
        //assets
        ABI_BYTE.encode(0),
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        // pact pool
        ABI_BYTE.encode(1),
      ],
      foreignAssets: [
        this.primaryLendingPool.fAsset.index,
        this.secondaryLendingPool.fAsset.index,
        this.pactPool.liquidityAsset.index,
      ],
      foreignApps: [this.pactPool.appId],
    });

    const tx3 = algosdk.makeApplicationNoOpTxnFromObject({
      from: options.address,
      suggestedParams: spFee(options.suggestedParams, POST_REM_LIQ_FEE),
      appIndex: this.appId,
      appArgs: [
        POST_REMOVE_LIQUIDITY_SIG,
        //assets
        ABI_BYTE.encode(0),
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        ABI_BYTE.encode(3),
        //apps
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        ABI_BYTE.encode(3),
        // Other
        ABI_BYTE.encode(0), // min expected primary
        ABI_BYTE.encode(0), // min expected secondary
      ],
      foreignAssets: [
        this.primaryLendingPool.originalAsset.index,
        this.secondaryLendingPool.originalAsset.index,
        this.primaryLendingPool.fAsset.index,
        this.secondaryLendingPool.fAsset.index,
      ],
      foreignApps: [
        this.primaryLendingPool.appId,
        this.secondaryLendingPool.appId,
        this.primaryLendingPool.managerAppId,
      ],
    });

    return [tx1, tx2, tx3];
  }

  prepareSwap(options: SwapOptions): LendingSwap {
    const fAsset = this.originalAssetToFAsset(options.asset);

    let depositedLendingPool = this.secondaryLendingPool;
    let receivedLendingPool = this.primaryLendingPool;
    if (options.asset.index === this.primaryLendingPool.originalAsset.index) {
      depositedLendingPool = this.primaryLendingPool;
      receivedLendingPool = this.secondaryLendingPool;
    }

    let fAmount: number;
    if (options.swapForExact) {
      fAmount = receivedLendingPool.convertDeposit(options.amount);
    } else {
      fAmount = depositedLendingPool.convertDeposit(options.amount);
    }

    const fSwap = this.pactPool.prepareSwap({
      ...options,
      asset: fAsset,
      amount: fAmount,
    });

    const assetDeposited = this.fAssetToOriginalAsset(fSwap.assetDeposited);
    const assetReceived = this.fAssetToOriginalAsset(fSwap.assetReceived);

    let amountDeposited: number;
    let amountReceived: number;
    if (options.swapForExact) {
      amountDeposited = depositedLendingPool.convertWithdraw(
        fSwap.effect.amountDeposited,
        { ceil: true },
      );
      amountReceived = options.amount;
    } else {
      amountDeposited = options.amount;
      amountReceived = receivedLendingPool.convertWithdraw(
        fSwap.effect.amountReceived,
      );
    }

    const minimumAmountReceived = receivedLendingPool.convertWithdraw(
      fSwap.effect.minimumAmountReceived,
    );

    const txFee = SWAP_FEE + 1000; // + deposit(1000)

    return {
      fSwap,
      assetDeposited,
      assetReceived,
      amountDeposited,
      amountReceived,
      minimumAmountReceived,
      txFee,
    };
  }

  async prepareSwapTxGroup(
    options: LendingSwapTxOptions,
  ): Promise<TransactionGroup> {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildSwapTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildSwapTxs({
    address,
    swap,
    suggestedParams,
  }: LendingSwapTxOptions & SuggestedParamsOption): algosdk.Transaction[] {
    const tx1 = swap.assetDeposited.buildTransferTx(
      address,
      this.escrowAddress,
      swap.amountDeposited,
      suggestedParams,
    );

    const tx2 = algosdk.makeApplicationNoOpTxnFromObject({
      from: address,
      suggestedParams: spFee(suggestedParams, SWAP_FEE),
      appIndex: this.appId,
      appArgs: [
        SWAP_SIG,
        //assets
        ABI_BYTE.encode(0),
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        ABI_BYTE.encode(3),
        //apps
        ABI_BYTE.encode(1),
        ABI_BYTE.encode(2),
        ABI_BYTE.encode(3),
        ABI_BYTE.encode(4),
        // others
        new algosdk.ABIUintType(64).encode(swap.minimumAmountReceived),
      ],
      foreignAssets: [
        this.primaryLendingPool.originalAsset.index,
        this.secondaryLendingPool.originalAsset.index,
        this.primaryLendingPool.fAsset.index,
        this.secondaryLendingPool.fAsset.index,
      ],
      foreignApps: [
        this.primaryLendingPool.appId,
        this.secondaryLendingPool.appId,
        this.primaryLendingPool.managerAppId,
        this.pactPool.appId,
      ],
    });

    return [tx1, tx2];
  }

  async prepareOptInToAssetTxGroup(
    options: OptInAssetToAdapterTxOptions,
  ): Promise<TransactionGroup> {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildOptInToAssetTxGroup({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildOptInToAssetTxGroup({
    assetIds,
    address,
    suggestedParams,
  }: OptInAssetToAdapterTxOptions & SuggestedParamsOption) {
    if (assetIds.length === 0 || assetIds.length > 8) {
      throw new PactSdkError("Length of assetIds must be between 1 and 8.");
    }

    assetIds = assetIds.filter((id) => id !== 0);

    const tx1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: address,
      to: this.escrowAddress,
      amount: assetIds.length * 100_000 + 100_000, // + min balance
      suggestedParams,
    });

    const tx2 = algosdk.makeApplicationNoOpTxnFromObject({
      from: address,
      suggestedParams: spFee(suggestedParams, 1000 + 1000 * assetIds.length),
      appIndex: this.appId,
      appArgs: [
        OPT_IN_SIG,
        new algosdk.ABIArrayDynamicType(new algosdk.ABIUintType(64)).encode(
          assetIds,
        ),
      ],
      foreignAssets: assetIds,
    });

    return [tx1, tx2];
  }
}
