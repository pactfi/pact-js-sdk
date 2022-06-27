import D from "decimal.js";

import { isqrt } from "./isqrt";
import { Pool } from "./pool";
import { SwapCalculator } from "./types";

export function getConstantProductMintedLiquidityTokens(
  addedPrimary: bigint,
  addedSecondary: bigint,
  totalPrimary: bigint,
  totalSecondary: bigint,
  totalLiquidity: bigint,
): bigint {
  if (totalPrimary + totalSecondary === 0n) {
    return isqrt(addedPrimary * addedSecondary);
  }

  const ltA = (addedPrimary * totalLiquidity) / totalPrimary;
  const ltB = (addedSecondary * totalLiquidity) / totalSecondary;
  return ltA > ltB ? ltB : ltA;
}

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

  getMintedLiquidityTokens(addedLiqA: bigint, addedLiqB: bigint): bigint {
    return getConstantProductMintedLiquidityTokens(
      addedLiqA,
      addedLiqB,
      BigInt(this.pool.state.totalPrimary),
      BigInt(this.pool.state.totalSecondary),
      BigInt(this.pool.state.totalLiquidity),
    );
  }
}
