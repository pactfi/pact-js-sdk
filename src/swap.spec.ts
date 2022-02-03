import { addLiqudity, makeFreshTestPool } from "./testUtils";

describe("swap", () => {
  it("...", async () => {
    const { account, algo, pool } = await makeFreshTestPool();

    // Empty liquidity.
    expect(() =>
      pool.prepareSwap({
        amount: 1000,
        asset: algo,
        slippagePct: 10,
      }),
    ).toThrow("Pool is empty and swaps are impossible.");

    // Equal liquidities.
    await addLiqudity(account, pool);
    // const swap = pool.prepareSwap({
    //   amount: 1000,
    //   asset: algo,
    //   slippagePct: 10,
    // });
    // expect(swap.stats).toEqual({});
  });
});
