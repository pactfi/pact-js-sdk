import { Pool, StableswapPoolParams } from "./pool";
import {
  StableswapCalculator,
  getAddLiquidityBonusPct,
  getTxFee,
} from "./stableswapCalculator";
import { TransactionGroup } from "./transactionGroup";

/**
 * The effect of adding liquidity to the pool.
 */
export type AddLiquidityEffect = {
  /**
   * Amount of new liquidity tokens minted when adding the liquidity. All the minted tokens will be received by the liquidity provider except of first 1000 minted tokens which are permanently locked in the contract.
   */
  mintedLiquidityTokens: number;

  /**
   * Current stableswap amplifier. Zero for constant product pools.
   */
  amplifier: number;

  /**
   * Only for stableswaps. Zero for constant product pools.
   *
   * A positive bonus means that after removing all the liquidity the user will end up with more tokens than he provided. This can happen when providing liquidity in a way that improves the pool balance.
   *
   * If adding the liquidity increases the pool imbalance, the bonus will be negative (a penalty).
   *
   * Also, a fee is subtracted from each liquidity addition. This negatively impacts the bonus.
   */
  bonusPct: number;

  /**
   * App call transaction fee.
   */
  txFee: number;
};

/**
 * A representation of an action of adding liquidity to the pool.
 *
 * Typically, users don't have to manually instantiate this class. Use [[Pool.prepareAddLiquidity]] instead.
 */
export class LiquidityAddition {
  /**
   * The pool to provide liquidity for.
   */
  pool: Pool;

  /**
   * The effect of adding the liquidity computed at the time of construction.
   */
  effect: AddLiquidityEffect;

  /**
   * Amount of primary asset the will be added to the pool.
   */
  primaryAssetAmount: number;

  /**
   * Amount of secondary asset the will be added to the pool.
   */
  secondaryAssetAmount: number;

  /**
   *
   * @param pool The pool to provide liquidity for.
   * @param primaryAssetAmount Amount of primary asset the will be added to the pool.
   * @param secondaryAssetAmount Amount of secondary asset the will be added to the pool.
   */
  constructor(
    pool: Pool,
    primaryAssetAmount: number,
    secondaryAssetAmount: number,
  ) {
    this.pool = pool;
    this.primaryAssetAmount = primaryAssetAmount;
    this.secondaryAssetAmount = secondaryAssetAmount;
    this.effect = this.buildEffect();
  }

  /**
   * Creates the transactions needed to perform adding liquidity and returns them as a transaction group ready to be signed and committed.
   *
   * @param address The account that will be performing adding liquidity.
   *
   * @returns A transaction group that when executed will add the liquidity to the pool.
   */
  prepareTxGroup(address: string): Promise<TransactionGroup> {
    return this.pool.prepareAddLiquidityTxGroup({
      liquidityAddition: this,
      address,
    });
  }

  private buildEffect(): AddLiquidityEffect {
    let amplifier = 0;
    let bonusPct = 0;
    let txFee = 3000;

    const swapCalc = this.pool.calculator.swapCalculator;
    const state = this.pool.state;

    const mintedLiquidityTokens = Number(
      swapCalc.getMintedLiquidityTokens(
        BigInt(this.primaryAssetAmount),
        BigInt(this.secondaryAssetAmount),
      ),
    );

    if (swapCalc instanceof StableswapCalculator) {
      const dAmplifier = swapCalc.getAmplifier();
      const params = this.pool.params as StableswapPoolParams;
      bonusPct = getAddLiquidityBonusPct(
        BigInt(this.primaryAssetAmount),
        BigInt(this.secondaryAssetAmount),
        BigInt(state.totalPrimary),
        BigInt(state.totalSecondary),
        BigInt(this.pool.feeBps),
        dAmplifier,
        BigInt(params.precision),
      );
      amplifier = Number(dAmplifier) / (this.pool.internalState.PRECISION ?? 1);
      txFee = getTxFee(swapCalc.mintTokensInvariantIterations, 4); // 1 for each invariant calculation (3) and 1 for sending liquidity tokens.
    }

    return {
      mintedLiquidityTokens,
      amplifier,
      bonusPct,
      txFee,
    };
  }
}
