import D from "decimal.js";

import { Pool } from "./pool";
import { SwapCalculator } from "./types";

/**
 * An implementation of a math behind constant product pools.
 */
export class ConstantProductCalculator implements SwapCalculator {
  constructor(public pool: Pool) {}

  getPrice(decimalLiqA: number, decimalLiqB: number): number {
    if (!decimalLiqA || !decimalLiqB) {
      return 0;
    }
    return decimalLiqB / decimalLiqA;
  }

  getSwapGrossAmountReceived(
    liqA: bigint,
    liqB: bigint,
    amountDeposited: bigint,
  ): bigint {
    return (liqB * amountDeposited) / (liqA + amountDeposited);
  }

  getSwapAmountDeposited(
    liqA: bigint,
    liqB: bigint,
    grossAmountReceived: bigint,
  ): bigint {
    // Using D to because of "ceil()"
    const dLiqA = new D(liqA.toString());
    const dLiqB = new D(liqB.toString());
    const dGrossAmountReceived = new D(grossAmountReceived.toString());
    return BigInt(
      dLiqA
        .mul(dGrossAmountReceived)
        .div(dLiqB.sub(dGrossAmountReceived))
        .ceil()
        .toNumber(),
    );
  }
}
