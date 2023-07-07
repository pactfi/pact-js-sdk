import { getConstantProductMintedLiquidityTokens } from "./constantProductCalculator";
import { PactSdkError } from "./exceptions";
import { Pool, StableswapPoolParams } from "./pool";
import {
  StableswapCalculator,
  getAddLiquidityBonusPct,
  getTxFee,
} from "./stableswapCalculator";
import { TransactionGroup } from "./transactionGroup";

// The amount of liquidity tokens that will be locked in a contract forever when adding the first liquidity.
const MIN_LT_AMOUNT = 1000;

export class AddLiquidityValidationError extends PactSdkError {}

/**
 * The effect of adding liquidity to the pool.
 */
export type AddLiquidityEffect = {
  /**
   * Amount of new liquidity tokens minted when adding the liquidity. All the minted tokens will be received by the liquidity provider except of first 1000 minted tokens which are permanently locked in the contract.
   */
  mintedLiquidityTokens: number;

  /**
   * Amount of minimum liquidity tokens received. The transaction will fail if the real value will be lower than this.
   */
  minimumMintedLiquidityTokens: number;

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
   * The maximum amount of slippage allowed in performing the add liquidity.
   */
  slippagePct: number;

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
    slippagePct: number,
  ) {
    this.pool = pool;
    this.primaryAssetAmount = primaryAssetAmount;
    this.secondaryAssetAmount = secondaryAssetAmount;
    this.slippagePct = slippagePct;

    this.validateLiquidityAddition();
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

  private validateLiquidityAddition() {
    if (this.pool.state.totalLiquidity === 0) {
      // First liquidity addition, the following condition must be met: sqrt(asset1 * asset2) - 1000 > 0
      const mintedLT = Math.sqrt(
        this.primaryAssetAmount * this.secondaryAssetAmount,
      );
      if (mintedLT <= MIN_LT_AMOUNT) {
        throw new AddLiquidityValidationError(
          "Provided amounts of tokens are too low.",
        );
      }
    }
    if (this.slippagePct < 0 || this.slippagePct > 100) {
      throw new AddLiquidityValidationError(
        "Splippage must be between 0 and 100.",
      );
    }
  }

  private buildEffect(): AddLiquidityEffect {
    let amplifier = 0;
    let bonusPct = 0;
    let txFee = 3000;
    let mintedLiquidityTokens = 0;

    const swapCalc = this.pool.calculator.swapCalculator;
    const state = this.pool.state;

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
      mintedLiquidityTokens = Number(
        swapCalc.getMintedLiquidityTokens(
          BigInt(this.primaryAssetAmount),
          BigInt(this.secondaryAssetAmount),
        ),
      );
      amplifier = Number(dAmplifier) / (this.pool.internalState.PRECISION ?? 1);
      txFee = getTxFee(swapCalc.mintTokensInvariantIterations, 4); // 1 for each invariant calculation (3) and 1 for sending liquidity tokens.
    } else {
      // Calculating without using calc, cause original pool may have different state, than the one provided (zap case).
      mintedLiquidityTokens = Number(
        getConstantProductMintedLiquidityTokens(
          BigInt(this.primaryAssetAmount),
          BigInt(this.secondaryAssetAmount),
          BigInt(state.totalPrimary),
          BigInt(state.totalSecondary),
          BigInt(state.totalLiquidity),
        ),
      );

      if (mintedLiquidityTokens <= 0) {
        throw new PactSdkError(
          "Amount of minted liquidity tokens must be greater then 0.",
        );
      }
    }

    let minimumMintedLiquidityTokens = Math.round(
      mintedLiquidityTokens - (mintedLiquidityTokens * this.slippagePct) / 100,
    );
    minimumMintedLiquidityTokens = Math.max(0, minimumMintedLiquidityTokens);

    // If this is the first liquidity addition, 1000 tokens will be locked in the contract.
    if (this.pool.state.totalLiquidity === 0) {
      minimumMintedLiquidityTokens -= 1000;
    }

    return {
      mintedLiquidityTokens,
      minimumMintedLiquidityTokens,
      amplifier,
      bonusPct,
      txFee,
    };
  }
}
