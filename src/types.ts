import { Pool } from "./pool";

export interface SwapCalculator {
  pool: Pool;

  /**
   * Calculates the price of assets. Accepts and returns decimal values.
   *
   * @param decimalLiqA Primary liquidity if calculating price for primary asset, secondary otherwise.
   * @param decimalLiqB Secondary liquidity if calculating price for primary asset, primary otherwise.
   *
   * @returns The price of one asset in relation to the other.
   */
  getPrice(decimalLiqA: number, decimalLiqB: number): number;

  /**
   * Converts amountDeposited to amountReceived. Ignores fee calculations.
   *
   * @param liqA Primary liquidity if swapping primary asset, secondary otherwise.
   * @param liqB Secondary liquidity if swapping primary asset, primary otherwise.
   * @param amountDeposited Amount of the asset deposited in the contract.
   *
   * @returns Amount of asset received from the contract after swap.
   */
  getSwapGrossAmountReceived(
    liqA: bigint,
    liqB: bigint,
    amountDeposited: bigint,
  ): bigint;

  /**
   * * Converts amountReceived to amountDeposited. Ignores fee calculations.
   *
   * @param liqA Primary liquidity if swapping primary asset, secondary otherwise.
   * @param liqB Secondary liquidity if swapping primary asset, primary otherwise.
   * @param amountReceived Amount of asset the user want to receive from the swap.
   *
   * @returns Amount of the asset the user has to deposit in the contract.
   */
  getSwapAmountDeposited(
    liqA: bigint,
    liqB: bigint,
    amountReceived: bigint,
  ): bigint;

  /**
   * Returns amount of liquidity tokens that are going to be minted when adding liquidity.
   *
   * @param addedLiqA Amount of primary asset to add to the pool.
   * @param addedLiqB Amount of secondary asset to add to the pool.
   *
   * @returns Amount of liquidity tokens that will be minted and given to user.
   */
  getMintedLiquidityTokens(addedLiqA: bigint, addedLiqB: bigint): bigint;
}
