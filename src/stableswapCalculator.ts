import { PactSdkError } from "./exceptions";
import { isqrt } from "./isqrt";
import { Pool, StableswapPoolParams } from "./pool";
import { SwapCalculator } from "./types";

const MAX_GET_PRICE_RETRIES = 5;

export class ConvergenceError extends PactSdkError {}

/**
 * An implementation of a math behind stableswap pools.
 */
export class StableswapCalculator implements SwapCalculator {
  constructor(public pool: Pool) {}

  get stableswapParams() {
    return this.pool.params as StableswapPoolParams;
  }

  getAmplifier(): bigint {
    // Linear interpolation based on current timestamp.
    const params = this.stableswapParams;
    const now = Date.now();
    const dt = params.futureATime - params.initialATime;
    const dv = params.futureA - params.initialA;
    if (!dt || !dv) {
      return BigInt(params.futureA);
    }

    const dvPerMS = dv / dt;

    const [minA, maxA] =
      params.futureA > params.initialA
        ? [params.initialA, params.futureA]
        : [params.futureA, params.initialA];

    let currentA = params.initialA + (now - params.initialATime) * dvPerMS;
    currentA = Math.max(minA, Math.min(maxA, Math.round(currentA)));

    return BigInt(currentA);
  }

  /**
   * May return NaN for highly unbalanced pools.
   */
  getPrice(decimalLiqA: number, decimalLiqB: number): number {
    if (!decimalLiqA || !decimalLiqB) {
      return 0;
    }

    const ratio = this.pool.primaryAsset.ratio;
    if (ratio !== this.pool.secondaryAsset.ratio) {
      console.warn(
        "Number of decimals differs between primary and secondary asset. Stableswap does not support this scenario correctly.",
      );
    }

    return this._getPrice(decimalLiqA, decimalLiqB, MAX_GET_PRICE_RETRIES);
  }

  /**
   * Price is calculated by simulating a swap for 10**6 of micro values.
   * This price is highly inaccurate for low liquidity pools.
   * In case of ConvergenceError we try to simulate a swap using a different swap amount.
   * Returns NaN if all retries will fail.
   */
  private _getPrice(
    decimalLiqA: number,
    decimalLiqB: number,
    retries: number,
  ): number {
    if (retries <= 0) {
      return NaN;
    }

    const ratio = this.pool.primaryAsset.ratio;
    const nLiqA = decimalLiqA * ratio;
    const nLiqB = decimalLiqB * ratio;
    const liqA = BigInt(Math.round(nLiqA));
    const liqB = BigInt(Math.round(nLiqB));
    const nAmountDeposited = 10 ** (6 + MAX_GET_PRICE_RETRIES - retries);
    const amountDeposited = BigInt(
      // The division helps minimize price impact of simulated swap.
      Math.round(Math.min(nAmountDeposited, nLiqA / 100, nLiqB / 100)),
    );

    try {
      const amountReceived = this.getSwapGrossAmountReceived(
        liqB,
        liqA,
        amountDeposited,
      );
      if (amountReceived === 0n) {
        return this._getPrice(decimalLiqA, decimalLiqB, retries - 1);
      }
      return Number(amountDeposited) / Number(amountReceived);
    } catch (error: any) {
      if (error instanceof ConvergenceError) {
        return this._getPrice(decimalLiqA, decimalLiqB, retries - 1);
      }
      throw error;
    }
  }

  getSwapGrossAmountReceived(
    liqA: bigint,
    liqB: bigint,
    amountDeposited: bigint,
  ): bigint {
    const amplifier = this.getAmplifier();
    const invariant = this.getInvariant(liqA, liqB, amplifier);
    const newLiqB = this.getNewLiq(
      liqA + amountDeposited,
      amplifier,
      invariant,
    );
    return liqB - newLiqB;
  }

  getSwapAmountDeposited(
    liqA: bigint,
    liqB: bigint,
    grossAmountReceived: bigint,
  ): bigint {
    const amplifier = this.getAmplifier();
    const invariant = this.getInvariant(liqA, liqB, amplifier);
    const newLiqA = this.getNewLiq(
      liqB - grossAmountReceived,
      amplifier,
      invariant,
    );
    return newLiqA - liqA;
  }

  private getInvariant(liqA: bigint, liqB: bigint, amp: bigint): bigint {
    const tokens_total = liqA + liqB;
    const S = tokens_total;
    if (S === 0n) {
      return S;
    }

    const precision = BigInt(this.stableswapParams.precision);

    let D = S;
    const Ann = amp * 4n;

    let i = 0;
    let Dprev = D;
    while (i < 255) {
      i += 1;
      let D_P = D;
      D_P = (D_P * D) / (liqA * 2n);
      D_P = (D_P * D) / (liqB * 2n);
      Dprev = D;
      const numerator = D * ((Ann * S) / precision + D_P * 2n);
      const divisor = ((Ann - precision) * D) / precision + 3n * D_P;
      D = numerator / divisor;
      if (D > Dprev) {
        if (D - Dprev <= 1n) {
          break;
        }
      } else if (Dprev - D <= 1n) {
        break;
      }
    }
    if (i === 255) {
      throw new ConvergenceError(`Didn't converge Dprev=${Dprev}, D=${D}`);
    }
    return D;
  }

  private getNewLiq(liqOther: bigint, amplifier: bigint, inv: bigint): bigint {
    const precision = BigInt(this.stableswapParams.precision);

    const S = liqOther;
    const D = inv;
    const A = amplifier;
    const P = liqOther;
    const Ann = A * 4n;

    const b = S + (D * precision) / Ann;
    const c = (precision * (D * D * D)) / (4n * P * Ann);

    const a_q = 1n;
    const b_q = b - D;
    const c_q = -c;

    const delta = b_q * b_q - 4n * a_q * c_q;
    return (-b_q + isqrt(delta)) / (2n * a_q);
  }
}
