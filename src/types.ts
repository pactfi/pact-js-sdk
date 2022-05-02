import { Pool } from "./pool";

export interface SwapCalculator {
  pool: Pool;
  getPrice(decimalLiqA: number, decimalLiqB: number): number;
  // For the following two methods:
  // liqA - primary liquidity if swapping primary asset, secondary otherwise
  // liqB - vice versa
  getSwapGrossAmountIn(liqA: bigint, liqB: bigint, amountOut: bigint): bigint;
  getSwapAmountOut(liqA: bigint, liqB: bigint, amountIn: bigint): bigint;
}
