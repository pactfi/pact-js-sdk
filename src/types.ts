import { Pool } from "./pool";

export interface SwapCalculator {
  pool: Pool;
  getPrice(decimalLiqA: number, decimalLiqB: number): number;
  // For the following two methods:
  // liqA - primary liquidity if swapping primary asset, secondary otherwise
  // liqB - vice versa
  getSwapGrossAmountReceived(
    liqA: bigint,
    liqB: bigint,
    amountDeposited: bigint,
  ): bigint;
  getSwapAmountDeposited(
    liqA: bigint,
    liqB: bigint,
    amountReceived: bigint,
  ): bigint;
}
