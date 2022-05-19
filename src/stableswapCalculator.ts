import { isqrt } from "./isqrt";
import { Pool, StableswapPoolParams } from "./pool";
import { SwapCalculator } from "./types";

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

    // Price is calculated by simulating a swap for 1 token.
    // This price is highly inaccurate for low liquidity pools.
    const nLiqA = decimalLiqA * ratio;
    const nLiqB = decimalLiqB * ratio;
    const liqA = BigInt(Math.round(nLiqA));
    const liqB = BigInt(Math.round(nLiqB));
    const amountDeposited = BigInt(
      // The division helps minimize price impact of simulated swap.
      Math.round(Math.min(ratio, nLiqA / 100, nLiqB / 100)),
    );
    const amountReceived = this.getSwapGrossAmountReceived(
      liqA,
      liqB,
      amountDeposited,
    );
    return Number(amountDeposited) / Number(amountReceived);
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

    let D = S;
    const Ann = amp * 2n;
    let i = 0;
    let Dprev = D;
    while (i < 255) {
      i += 1;
      let D_P = D;
      D_P = (D_P * D) / (liqA * 2n);
      D_P = (D_P * D) / (liqB * 2n);
      Dprev = D;
      const numerator = D * (Ann * S + D_P * 2n);
      const divisor = (Ann - 1n) * D + 3n * D_P;
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
      throw Error(`Didn't converge Dprev=${Dprev}, D=${D}`);
    }
    return D;
  }

  private getNewLiq(liqOther: bigint, amplifier: bigint, inv: bigint): bigint {
    const S = liqOther;
    const D = inv;
    const A = amplifier;
    const P = liqOther;
    const Ann = A * 2n;

    const b = S + D / Ann;
    const c = (D * D * D) / (4n * P * Ann);

    const a_q = 1n;
    const b_q = b - D;
    const c_q = -c;

    const delta = b_q * b_q - 4n * a_q * c_q;
    return (-b_q + isqrt(delta)) / (2n * a_q);
  }
}
