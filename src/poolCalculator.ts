import D from "decimal.js";

import { Asset } from "./asset";
import { ConstantProductCalculator } from "./constantProductCalculator";
import { PactSdkError } from "./exceptions";
import { Pool } from "./pool";
import { StableswapCalculator } from "./stableswapCalculator";
import { SwapCalculator } from "./types";

/**
 * Contains functions for calculation statistics and other numerical data about the pool.
 *
 * The pool calculator uses internal data from the pool to calculate values like the Prices, Net Amounts and values for the swap. Uses different formulas based on pool type.
 */
export class PoolCalculator {
  swapCalculator: SwapCalculator;

  constructor(private pool: Pool) {
    if (pool.poolType === "CONSTANT_PRODUCT") {
      this.swapCalculator = new ConstantProductCalculator(pool);
    } else if (pool.poolType === "STABLESWAP") {
      this.swapCalculator = new StableswapCalculator(pool);
    } else {
      throw new PactSdkError(`Unknown pool type: ${pool.poolType}`);
    }
  }

  get primaryAssetAmount() {
    return BigInt(this.pool.internalState.A);
  }

  get secondaryAssetAmount() {
    return BigInt(this.pool.internalState.B);
  }

  get primaryAssetAmountDecimal() {
    return this.pool.internalState.A / this.pool.primaryAsset.ratio;
  }

  get secondaryAssetAmountDecimal() {
    return this.pool.internalState.B / this.pool.secondaryAsset.ratio;
  }

  /**
   * Checks if the pool is currently empty.
   *
   * A pool is empty if either the primary or secondary asset is zero.
   *
   * @returns true if the pool is empty, false otherwise.
   */
  get isEmpty() {
    return this.primaryAssetAmount === 0n || this.secondaryAssetAmount === 0n;
  }

  /**
   * @returns Amount of secondary assets for a single primary asset.
   */
  get primaryAssetPrice() {
    return this.swapCalculator.getPrice(
      this.primaryAssetAmountDecimal,
      this.secondaryAssetAmountDecimal,
    );
  }

  /**
   * @returns Amount of primary assets for a single secondary asset.
   */
  get secondaryAssetPrice() {
    return this.swapCalculator.getPrice(
      this.secondaryAssetAmountDecimal,
      this.primaryAssetAmountDecimal,
    );
  }

  /**
   * Converts amount deposited in the contract to amount received from the contract. Includes fee calculations.
   *
   * @param asset Asset to deposit in the contract.
   * @param amountDeposited Amount to deposit in the contract.
   *
   * @returns The amount to receive from the contract.
   */
  amountDepositedToNetAmountReceived(
    asset: Asset,
    amountDeposited: bigint,
  ): bigint {
    const grossAmountReceived = this.amountDepositedToGrossAmountReceived(
      asset,
      amountDeposited,
    );
    const fee = this.getFeeFromGrossAmount(grossAmountReceived);
    const netAmountReceived = grossAmountReceived - fee;
    return netAmountReceived;
  }

  /**
   * Converts amount received from the contract to amount deposited in the contract.
   *
   * @param asset Asset to deposit in the contract.
   * @param netAmountReceived Amount to receive from the contract.
   * @returns The amount to deposit in the contract.
   */
  netAmountReceivedToAmountDeposited(
    asset: Asset,
    netAmountReceived: bigint,
  ): bigint {
    const fee = this.getFeeFromNetAmount(netAmountReceived);
    netAmountReceived += fee;
    return this.grossAmountReceivedToAmountDeposited(asset, netAmountReceived);
  }

  /**
   * Calculates the fee from the gross amount based on pool's feeBps.
   *
   * @param grossAmount The amount to receive from the contract not yet lessened by the fee.
   *
   * @returns The calculated fee.
   */
  getFeeFromGrossAmount(grossAmount: bigint): bigint {
    const feeBps = BigInt(this.pool.feeBps);
    return grossAmount - (grossAmount * (10_000n - feeBps)) / 10_000n;
  }

  /**
   * Calculates the fee from the net amount based on pool's feeBps. This is used in the swap exact for calculations.
   *
   * @param netAmount The amount to receive from the contract already lessened by the fee.
   *
   * @returns The calculated fee.
   */
  getFeeFromNetAmount(netAmount: bigint): bigint {
    // Using D because of "ceil()"
    const dNetAmount = new D(netAmount.toString());
    return BigInt(
      dNetAmount
        .div((10_000 - this.pool.feeBps) / 10_000)
        .sub(dNetAmount)
        .ceil()
        .toNumber(),
    );
  }

  private grossAmountReceivedToAmountDeposited(
    asset: Asset,
    intGrossAmountReceived: bigint,
  ): bigint {
    const [A, B] = this.getLiquidities(asset);
    return this.swapCalculator.getSwapAmountDeposited(
      A,
      B,
      intGrossAmountReceived,
    );
  }

  private amountDepositedToGrossAmountReceived(
    asset: Asset,
    amountDeposited: bigint,
  ): bigint {
    const [A, B] = this.getLiquidities(asset);
    return this.swapCalculator.getSwapGrossAmountReceived(
      A,
      B,
      amountDeposited,
    );
  }

  /**
   * Returns the array of liquidities from the pool, sorting them by setting provided asset as primary.
   *
   * @param asset The asset that is supposed to be the primary one.
   *
   * @returns Total liquidities of assets.
   */
  getLiquidities(asset: Asset): [bigint, bigint] {
    let [A, B] = [this.primaryAssetAmount, this.secondaryAssetAmount];
    if (asset.index !== this.pool.primaryAsset.index) {
      [A, B] = [B, A];
    }
    return [A, B];
  }

  /**
   * Based on the deposited amount and a slippage, calculate the minimum amount the user will receive from the contract.
   *
   * @param asset The asset to deposit in the contract.
   * @param amountDeposited The amount to deposit in the contract.
   * @param slippageBps Slippage in base points.
   *
   * @returns The minimum amount to receive from the contract.
   */
  getMinimumAmountReceived(
    asset: Asset,
    amountDeposited: bigint,
    slippageBps: bigint,
  ): bigint {
    const amountReceived = this.amountDepositedToNetAmountReceived(
      asset,
      amountDeposited,
    );
    return amountReceived - (amountReceived * slippageBps) / 10_000n;
  }

  /**
   * Calculates the exchange fee based on deposited amount.
   *
   * @param asset The asset to deposit in the contract.
   * @param amountDeposited The amount to deposit in the contract.
   *
   * @returns The calculated fee.
   */
  getFee(asset: Asset, amountDeposited: bigint): bigint {
    return (
      this.amountDepositedToGrossAmountReceived(asset, amountDeposited) -
      this.amountDepositedToNetAmountReceived(asset, amountDeposited)
    );
  }

  /**
   * Simulates new asset price after changing the pool's liquidity.
   *
   * @param asset The asset for which to calculate the price for.
   * @param primaryLiqChange The change of primary liquidity on the pool.
   * @param secondaryLiqChange The change of secondary liquidity on the pool.
   *
   * @returns New asset price.
   */
  getAssetPriceAfterLiqChange(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): number {
    const newPrimaryLiq =
      (this.pool.internalState.A + primaryLiqChange) /
      this.pool.primaryAsset.ratio;

    const newSecondaryLiq =
      (this.pool.internalState.B + secondaryLiqChange) /
      this.pool.secondaryAsset.ratio;

    if (asset.index === this.pool.primaryAsset.index) {
      return this.swapCalculator.getPrice(newPrimaryLiq, newSecondaryLiq);
    }
    return this.swapCalculator.getPrice(newSecondaryLiq, newPrimaryLiq);
  }

  /**
   * Calculates the price impact of changing the liquidity in a certain way.
   *
   * @param asset The asset for which to calculate the price impact for.
   * @param primaryLiqChange The change of primary liquidity on the pool.
   * @param secondaryLiqChange The change of secondary liquidity on the pool.
   *
   * @returns The asset price impact.
   */
  getPriceImpactPct(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): number {
    const newPrice = this.getAssetPriceAfterLiqChange(
      asset,
      primaryLiqChange,
      secondaryLiqChange,
    );
    const oldPrice =
      asset.index === this.pool.primaryAsset.index
        ? this.primaryAssetPrice
        : this.secondaryAssetPrice;
    return (newPrice * 100) / oldPrice - 100;
  }

  /**
   * Calculates the price for which the asset in going to be swapped.
   *
   * @param assetDeposited The asset deposited in the contract.
   * @param amountDeposited The amount deposited in the contract.
   *
   * @returns The price of deposited asset in relation to received asset.
   */
  getSwapPrice(assetDeposited: Asset, amountDeposited: bigint): number {
    const assetReceived = this.pool.getOtherAsset(assetDeposited);
    const amountReceived = this.amountDepositedToGrossAmountReceived(
      assetDeposited,
      amountDeposited,
    );
    const diff_ratio = assetDeposited.ratio / assetReceived.ratio;
    return (Number(amountReceived) / Number(amountDeposited)) * diff_ratio;
  }
}
