import { Asset } from "./asset";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

/**
 * Swap Effect are the basic details of the effect on the pool of performing the swap.
 *
 * The swap effect contains the assets in and out for the swap including the minimum amount
 * to deposit based on the slippage allowed, the fee incurred and the implied price from the in and
 * out assets.
 *
 * It also includes the effect on the liquidity pool with the new primary and secondary asset amounts, and the
 * percentage change this represents.
 *
 */
export type SwapEffect = {
  amountIn: number;
  amountOut: number;
  minimumAmountIn: number;
  primaryAssetPriceAfterSwap: number;
  secondaryAssetPriceAfterSwap: number;
  primaryAssetPriceImpactPct: number;
  secondaryAssetPriceImpactPct: number;
  fee: number;
  price: number;
};

/**
 * Swap class represents a swap trade if an amount of asset on a particular pool.
 *
 * The swap class contains methods to ensure the swap is valid and prepare the transaction. It also contains
 * a method to report the effect of the swap on the current pool values.
 */
export class Swap {
  /** The effect of the swap computed at the time of construction. */
  effect: SwapEffect;

  /** The asset deposited in order to make the swap. */
  assetIn = this.pool.getOtherAsset(this.assetOut);

  /**
   * Creates a Swap Trade for a given amount of received asset based in the given liquidity pool.
   *
   * Note that as part of construction this function validates the inputs and will throw and error if
   * the parameters are invalid. See validateSwap for details of the validation done.
   * The constructor will also record the effect of the swap based on the current pool values.
   *
   * @param pool the pool the swap is going to be performed in.
   * @param assetOut the asset that will result from the swap.
   * @param amountOut the amount of asset returned after the swap.
   * @param slippagePct the maximum amount of slippage allowed in performing the swap.
   */
  constructor(
    public pool: Pool,
    public assetOut: Asset,
    public amountOut: number,
    public slippagePct: number,
  ) {
    this.validateSwap();
    this.effect = this.buildEffect();
  }

  /**
   * Creates the transactions needed to perform the swap trade and returns them as a transaction group ready to be signed and committed.
   *
   * @param address the account that will be performing the swap
   * @returns A TransactionGroup that can perform the swap. There will be two transactions in the group.
   */
  prepareTxGroup(address: string): Promise<TransactionGroup> {
    return this.pool.prepareSwapTxGroup({ swap: this, address });
  }

  /**
   * @private Checks that the parameters of the swap are valid
   *
   * @throws if the slippage is invalid - it must be in the range 0 - 100
   * @throws if the pool is empty.
   */
  private validateSwap() {
    if (this.slippagePct < 0 || this.slippagePct > 100) {
      throw Error("Splippage must be between 0 and 100");
    }
    if (this.pool.calculator.isEmpty) {
      throw Error("Pool is empty and swaps are impossible.");
    }
  }

  private buildEffect(): SwapEffect {
    const amountIn = Math.floor(
      this.pool.calculator
        .getAmountIn(this.assetOut, this.amountOut)
        .toNumber(),
    );

    let primaryLiqChange, secondaryLiqChange: number;
    if (this.assetOut.index === this.pool.primaryAsset.index) {
      primaryLiqChange = this.amountOut;
      secondaryLiqChange = -amountIn;
    } else {
      primaryLiqChange = -amountIn;
      secondaryLiqChange = this.amountOut;
    }

    const primaryAssetPriceAfterSwap = this.pool.calculator
      .getAssetPriceAfterLiqChange(
        this.pool.primaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      )
      .toNumber();
    const secondaryAssetPriceAfterSwap = this.pool.calculator
      .getAssetPriceAfterLiqChange(
        this.pool.secondaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      )
      .toNumber();

    return {
      amountOut: this.amountOut,
      amountIn,
      minimumAmountIn: Math.floor(
        this.pool.calculator
          .getMinimumAmountIn(this.assetOut, this.amountOut, this.slippagePct)
          .toNumber(),
      ),
      price: this.pool.calculator.getSwapPrice(this.assetOut, this.amountOut),
      primaryAssetPriceAfterSwap,
      secondaryAssetPriceAfterSwap,
      primaryAssetPriceImpactPct: this.pool.calculator
        .getPriceImpactPct(
          this.pool.primaryAsset,
          primaryLiqChange,
          secondaryLiqChange,
        )
        .toNumber(),
      secondaryAssetPriceImpactPct: this.pool.calculator
        .getPriceImpactPct(
          this.pool.secondaryAsset,
          primaryLiqChange,
          secondaryLiqChange,
        )
        .toNumber(),
      fee: Math.ceil(
        this.pool.calculator.getFee(this.assetOut, this.amountOut).toNumber(),
      ),
    };
  }
}
