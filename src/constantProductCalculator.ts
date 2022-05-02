import D from "decimal.js";

import { Pool } from "./pool";
import { SwapCalculator } from "./types";

export class ConstantProductCalculator implements SwapCalculator {
  constructor(public pool: Pool) {}

  getPrice(decimalLiqA: number, decimalLiqB: number): number {
    if (!decimalLiqA || !decimalLiqB) {
      return 0;
    }
    return decimalLiqB / decimalLiqA;
  }

  getSwapGrossAmountIn(liqA: bigint, liqB: bigint, amountOut: bigint): bigint {
    return (liqB * amountOut) / (liqA + amountOut);
  }

  getSwapAmountOut(liqA: bigint, liqB: bigint, grossAmountIn: bigint): bigint {
    // Using D to because of "ceil()"
    const dLiqA = new D(liqA.toString());
    const dLiqB = new D(liqB.toString());
    const dGrossAmountIn = new D(grossAmountIn.toString());
    return BigInt(
      dLiqA
        .mul(dGrossAmountIn)
        .div(dLiqB.sub(dGrossAmountIn))
        .ceil()
        .toNumber(),
    );
  }
}
