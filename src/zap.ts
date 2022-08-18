import { LiquidityAddition } from "./addLiquidity";
import { Asset } from "./asset";
import { PactSdkError } from "./exceptions";
import { isqrt } from "./isqrt";
import { Pool } from "./pool";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";

const FEE_PRECISION = BigInt(10 ** 4);

/**
 * All amounts that should be used in swap and add liquidity transactions.
 */
export type ZapParams = {
  swapDeposited: bigint;
  primaryAddLiq: bigint;
  secondaryAddLiq: bigint;
};

export function getConstantProductZapParams(
  liqA: bigint,
  liqB: bigint,
  zapAmount: bigint,
  feeBps: bigint,
  pactFeeBps: bigint,
): ZapParams {
  const swapDeposited = getSwapAmountDepositedFromZapping(
    zapAmount,
    liqA,
    feeBps,
    pactFeeBps,
  );
  const primaryAddLiq = zapAmount - swapDeposited;
  const secondaryAddLiq = getSecondaryAddedLiquidityFromZapping(
    swapDeposited,
    liqA,
    liqB,
    feeBps,
  );
  return { swapDeposited, primaryAddLiq, secondaryAddLiq };
}

export function getSwapAmountDepositedFromZapping(
  zapAmount: bigint,
  totalAmount: bigint,
  feeBps: bigint,
  pactFeeBps: bigint,
): bigint {
  const poolFee = feeBps - pactFeeBps;
  const a = (-1n * FEE_PRECISION - poolFee + feeBps) / FEE_PRECISION;
  const b =
    (-2n * totalAmount * FEE_PRECISION +
      zapAmount * poolFee +
      totalAmount * feeBps) /
    FEE_PRECISION;
  const c = totalAmount * zapAmount;

  const delta = b * b - 4n * a * c;
  let result;
  if (b < 0) {
    result = (-1n * b - isqrt(delta)) / (2n * a);
  } else {
    result = (2n * c) / (-1n * b + isqrt(delta));
  }
  return result;
}

export function getSecondaryAddedLiquidityFromZapping(
  swapDeposited: bigint,
  totalPrimary: bigint,
  totalSecondary: bigint,
  feeBps: bigint,
): bigint {
  return (
    (swapDeposited * totalSecondary * (FEE_PRECISION - feeBps)) /
    ((totalPrimary + swapDeposited) * FEE_PRECISION)
  );
}

/**
 * Zap class represents a zap trade on a particular pool, which allows to exchange single asset for PLP token.
 *
 * Zap performs a swap to get second asset from the pool and then adds liquidity using both of those assets. Users may be left with some leftovers due to rounding and slippage settings.
 *
 * Zaps are meant only for Constant Product pools; For Stableswaps, adding only one asset works out of the box.
 *
 * Typically, users don't have to manually instantiate this class. Use [[Pool.prepareZap]] instead.
 */
export class Zap {
  /**
   * The pool the zap is going to be performed in.
   */
  pool: Pool;

  /**
   * The asset that will be used in zap.
   */
  asset: Asset;

  /**
   * Amount to be used in zap.
   */
  amount: number;

  /**
   * The maximum amount of slippage allowed in performing the swap.
   */
  slippagePct: number;

  /**
   * The swap object that will be executed during the zap.
   */
  swap: Swap;

  /**
   * Liquidity Addition object that will be executed during the zap.
   */
  liquidityAddition: LiquidityAddition;

  /**
   * All amounts used in swap and add liquidity transactions.
   */
  params: ZapParams;

  /**
   * @param pool The pool the zap is going to be performed in.
   * @param asset The asset that will be used in zap.
   * @param amount Amount to be used in zap.
   * @param slippagePct The maximum amount of slippage allowed in performing the swap.
   */
  constructor(pool: Pool, asset: Asset, amount: number, slippagePct: number) {
    if (!pool.isAssetInThePool(asset)) {
      throw new PactSdkError("Provided asset was not found in the pool.");
    }
    if (pool.poolType === "STABLESWAP") {
      throw new PactSdkError("Zap can only be made on constant product pools.");
    }
    this.pool = pool;
    this.asset = asset;
    this.amount = amount;
    this.slippagePct = slippagePct;

    this.params = this.getZapParams();
    this.swap = pool.prepareSwap({
      amount: Number(this.params.swapDeposited),
      asset,
      slippagePct,
    });
    this.liquidityAddition = this.prepareAddLiq();
  }

  /**
   * Creates the transactions needed to perform zap and returns them as a transaction group ready to be signed and committed.
   *
   * @param address The account that will be performing the zap.
   *
   * @returns A transaction group that when executed will perform the zap.
   */
  prepareTxGroup(address: string): Promise<TransactionGroup> {
    return this.pool.prepareZapTxGroup({
      zap: this,
      address,
    });
  }

  private isAssetPrimary() {
    return this.asset.index === this.pool.primaryAsset.index;
  }

  getZapParams() {
    const [totalA, totalB] = this.pool.calculator.getLiquidities(this.asset);
    if (totalA === 0n || totalB === 0n) {
      throw new PactSdkError("Cannot create a Zap on empty pool.");
    }

    const params = getConstantProductZapParams(
      totalA,
      totalB,
      BigInt(this.amount),
      BigInt(this.pool.params.feeBps),
      BigInt(this.pool.params.pactFeeBps),
    );
    if (!this.isAssetPrimary()) {
      // Reverse primary & secondary if provided asset was secondary.
      const temp = params.primaryAddLiq;
      params.primaryAddLiq = params.secondaryAddLiq - 1n;
      params.secondaryAddLiq = temp;
    } else {
      // There is a small rounding error in many transactions. Substracting 1 solves this problem.
      params.secondaryAddLiq -= 1n;
    }
    return params;
  }

  prepareAddLiq() {
    // Minted liquidity tokens need to be calculated based on the state after the swap.
    const updatedState = { ...this.pool.state };
    if (this.isAssetPrimary()) {
      updatedState.totalPrimary += Number(this.params.swapDeposited);
      updatedState.totalSecondary -= Number(this.params.secondaryAddLiq);
    } else {
      updatedState.totalPrimary -= Number(this.params.primaryAddLiq);
      updatedState.totalSecondary += Number(this.params.swapDeposited);
    }

    return new LiquidityAddition(
      { ...this.pool, state: updatedState } as Pool,
      Number(this.params.primaryAddLiq),
      Number(this.params.secondaryAddLiq),
    );
  }
}
