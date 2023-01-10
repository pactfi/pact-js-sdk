import algosdk from "algosdk";

import { Asset, getAlgo } from "../asset";
import { PactClient } from "../client";
import { setGasStation } from "../gasStation";
import {
  algod,
  createAsset,
  deployGasStation,
  getLastBlock,
  newAccount,
  signAndSend,
  waitRounds,
} from "../testUtils";
import { TransactionGroup } from "../transactionGroup";
import { Escrow } from "./escrow";
import {
  deployFarm,
  makeFreshFarmingTestbed,
  makeNewAccountAndEscrow,
  makeNewAccountForFarm,
  updateFarm,
} from "./testFarmingUtils";

describe("Farming", () => {
  beforeAll(async () => {
    setGasStation(await deployGasStation());
  });

  it("fetch farm", async () => {
    const testbed = await makeFreshFarmingTestbed();

    const [userA, escrowA] = [testbed.userAccount, testbed.escrow];
    const [userB, escrowB] = await makeNewAccountAndEscrow(
      testbed.farm,
      testbed.adminAccount,
      [testbed.rewardAsset],
    );

    expect(escrowA.appId).not.toBe(escrowB.appId);

    // Fetch farm and escrow.
    let escrow: Escrow | null = await testbed.pact.farming.fetchEscrowById(
      escrowA.appId,
    );
    expect(escrow.appId).toBe(escrowA.appId);
    expect(escrow.farm.appId).toBe(testbed.farm.appId);

    // Fetch only the farm.
    const farm = await testbed.pact.farming.fetchFarmById(testbed.farm.appId);
    expect(farm.appId).toBe(testbed.farm.appId);

    // Fetch escrow from the farm.

    // By id.
    escrow = await farm.fetchEscrowById(escrowA.appId);
    expect(escrow.appId).toBe(escrowA.appId);
    escrow = await farm.fetchEscrowById(escrowB.appId);
    expect(escrow.appId).toBe(escrowB.appId);

    // By addr.
    escrow = await farm.fetchEscrowByAddress(userA.addr);
    expect(escrow!.appId).toBe(escrowA.appId);
    escrow = await farm.fetchEscrowByAddress(userB.addr);
    expect(escrow!.appId).toBe(escrowB.appId);

    // From account info.
    const infoA = await testbed.pact.algod.accountInformation(userA.addr).do();
    escrow = await testbed.farm.fetchEscrowFromAccountInfo(infoA);
    expect(escrow!.appId).toBe(escrowA.appId);
    const infoB = await testbed.pact.algod.accountInformation(userB.addr).do();
    escrow = await testbed.farm.fetchEscrowFromAccountInfo(infoB);
    expect(escrow!.appId).toBe(escrowB.appId);
  });

  it("farm state", async () => {
    const testbed = await makeFreshFarmingTestbed();

    let lastBlock = await getLastBlock();

    expect(testbed.farm.internalState).toEqual({
      stakedAssetId: testbed.stakedAsset.index,
      rewardAssetIds: [],
      distributedRewards: [0, 0, 0, 0, 0, 0, 0],
      claimedRewards: [0, 0, 0, 0, 0, 0, 0],
      pendingRewards: [0, 0, 0, 0, 0, 0, 0],
      nextRewards: [0, 0, 0, 0, 0, 0, 0],
      rptFrac: [0, 0, 0, 0, 0, 0, 0],
      rpt: [0, 0, 0, 0, 0, 0, 0],
      duration: 0,
      nextDuration: 0,
      numStakers: 0,
      totalStaked: 0,
      updatedAt: lastBlock - 6,
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });
    expect(testbed.farm.state).toEqual({
      stakedAsset: testbed.stakedAsset,
      rewardAssets: [],
      distributedRewards: {},
      claimedRewards: {},
      pendingRewards: {},
      nextRewards: {},
      rpt: {},
      duration: 0,
      nextDuration: 0,
      numStakers: 0,
      totalStaked: 0,
      updatedAt: new Date((lastBlock - 6) * 1000),
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });

    await testbed.depositRewards({ [testbed.rewardAsset.index]: 2000 }, 100);
    lastBlock = await getLastBlock();

    expect(testbed.farm.state).toEqual({
      stakedAsset: testbed.stakedAsset,
      rewardAssets: [testbed.rewardAsset],
      distributedRewards: { [testbed.rewardAsset.index]: 0 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      pendingRewards: { [testbed.rewardAsset.index]: 2000 },
      nextRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0 },
      duration: 100,
      nextDuration: 0,
      numStakers: 0,
      totalStaked: 0,
      updatedAt: new Date(lastBlock * 1000),
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });

    await testbed.stake(1000);
    await testbed.farm.updateState();
    lastBlock = await getLastBlock();

    expect(testbed.farm.state).toEqual({
      stakedAsset: testbed.stakedAsset,
      rewardAssets: [testbed.rewardAsset],
      distributedRewards: { [testbed.rewardAsset.index]: 0 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      pendingRewards: { [testbed.rewardAsset.index]: 2000 },
      nextRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0 },
      duration: 100,
      nextDuration: 0,
      numStakers: 1,
      totalStaked: 1000,
      updatedAt: new Date(lastBlock * 1000),
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });

    const userState = await testbed.escrow.fetchUserState();
    expect(userState).toEqual({
      escrowId: testbed.escrow.appId,
      staked: 1000,
      accruedRewards: { [testbed.rewardAsset.index]: 0 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0 },
    });
  });

  it("happy path", async () => {
    const testbed = await makeFreshFarmingTestbed();

    // Deposit rewards.
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 2000 }, 100);

    // Stake.
    await testbed.stake(1000);
    let holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(1000);

    // Check farm and user state.
    await testbed.farm.updateState();
    let userState = await testbed.escrow.fetchUserState();
    expect(userState).toEqual({
      escrowId: testbed.escrow.appId,
      staked: 1000,
      accruedRewards: { [testbed.rewardAsset.index]: 0 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0 },
    });
    expect(testbed.farm.state).toMatchObject({
      stakedAsset: testbed.stakedAsset,
      rewardAssets: [testbed.rewardAsset],
      distributedRewards: { [testbed.rewardAsset.index]: 0 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      pendingRewards: { [testbed.rewardAsset.index]: 2000 },
      nextRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0 },
      duration: 100,
      nextDuration: 0,
      numStakers: 1,
      totalStaked: 1000,
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });

    // Wait some time and unstake all.
    await waitRounds(10, testbed.userAccount);
    await testbed.unstake(1000);
    holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(0);

    // Check the state.
    await testbed.farm.updateState();
    userState = await testbed.escrow.fetchUserState();
    expect(userState).toEqual({
      escrowId: testbed.escrow.appId,
      staked: 0,
      accruedRewards: { [testbed.rewardAsset.index]: 219 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0.22 },
    });
    expect(testbed.farm.state).toMatchObject({
      stakedAsset: testbed.stakedAsset,
      rewardAssets: [testbed.rewardAsset],
      distributedRewards: { [testbed.rewardAsset.index]: 220 },
      claimedRewards: { [testbed.rewardAsset.index]: 0 },
      pendingRewards: { [testbed.rewardAsset.index]: 1780 },
      nextRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0.22 },
      duration: 89,
      nextDuration: 0,
      numStakers: 0,
      totalStaked: 0,
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });

    // Claim rewards.
    await testbed.assertRewards(() => testbed.claim());

    // Accrued rewards are empty.
    await testbed.farm.updateState();
    userState = await testbed.escrow.fetchUserState();
    expect(userState).toEqual({
      escrowId: testbed.escrow.appId,
      staked: 0,
      accruedRewards: { [testbed.rewardAsset.index]: 0 },
      claimedRewards: { [testbed.rewardAsset.index]: 219 },
      rpt: { [testbed.rewardAsset.index]: 0.22 },
    });
    expect(testbed.farm.state).toMatchObject({
      stakedAsset: testbed.stakedAsset,
      rewardAssets: [testbed.rewardAsset],
      distributedRewards: { [testbed.rewardAsset.index]: 220 },
      claimedRewards: { [testbed.rewardAsset.index]: 219 },
      pendingRewards: { [testbed.rewardAsset.index]: 1780 },
      nextRewards: { [testbed.rewardAsset.index]: 0 },
      rpt: { [testbed.rewardAsset.index]: 0.22 },
      duration: 89,
      nextDuration: 0,
      numStakers: 0,
      totalStaked: 0,
      admin: testbed.adminAccount.addr,
      updater: testbed.adminAccount.addr,
      version: 100,
    });

    holding = await testbed.rewardAsset.getHolding(testbed.farm.appAddress);
    expect(holding).toBe(1781);

    holding = await testbed.rewardAsset.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(219);
  });

  it("stake and unstake", async () => {
    const testbed = await makeFreshFarmingTestbed();

    await testbed.depositRewards({ [testbed.rewardAsset.index]: 2000 }, 100);

    await testbed.stake(1000);
    await testbed.farm.updateState();
    let holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(1000);
    expect(testbed.farm.state.totalStaked).toBe(1000);

    await testbed.unstake(400);
    await testbed.farm.updateState();
    holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(600);
    expect(testbed.farm.state.totalStaked).toBe(600);

    await testbed.unstake(500);
    await testbed.farm.updateState();
    holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(100);
    expect(testbed.farm.state.totalStaked).toBe(100);

    // Can unstake everything.
    await testbed.unstake(100);
    await testbed.farm.updateState();
    holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(0);
    expect(testbed.farm.state.totalStaked).toBe(0);
  });

  it("estimate rewards", async () => {
    const testbed = await makeFreshFarmingTestbed();
    await testbed.stake(100);
    let userState = await testbed.escrow.fetchUserState();

    let atTime = new Date(testbed.farm.state.updatedAt.getTime() + 5000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({});
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({});

    await testbed.depositRewards({ [testbed.rewardAsset.index]: 1000 }, 10);

    // No next rewards, estimate zero second.

    atTime = testbed.farm.state.updatedAt;
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });

    // No next rewards, estimate first second.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 1000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 100,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 50,
    });

    // No next rewards, estimate middle of first cycle.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 5000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 500,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 45,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 250,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 200)).toEqual({
      [testbed.rewardAsset.index]: 333,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 2000)).toEqual({
      [testbed.rewardAsset.index]: 476,
    });

    // No next rewards, estimate end of first cycle.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 10_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 1000,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 90,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 500,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 200)).toEqual({
      [testbed.rewardAsset.index]: 666,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 2000)).toEqual({
      [testbed.rewardAsset.index]: 952,
    });

    // No next rewards, estimate future cycles.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 55_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 1000, // no future extrapolation for estimate.
    });
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 499,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 2750,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 200)).toEqual({
      [testbed.rewardAsset.index]: 3666,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 2000)).toEqual({
      [testbed.rewardAsset.index]: 5237,
    });

    // Deposit next rewards.
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 5000 }, 20);

    // Next rewards, estimate middle of first cycle. 4 seconds instead of 5 because depositRewards is one second.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 4_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 500,
    });
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 5000);
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 45,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 250,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 200)).toEqual({
      [testbed.rewardAsset.index]: 333,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 2000)).toEqual({
      [testbed.rewardAsset.index]: 476,
    });

    // Next rewards, estimate middle of next cycle.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 19_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 3500,
    });
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 20_000);
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 331,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 1825,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 200)).toEqual({
      [testbed.rewardAsset.index]: 2433,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 2000)).toEqual({
      [testbed.rewardAsset.index]: 3476,
    });

    // Next rewards, estimate future cycles.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 54_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 6000, // no future extrapolation for estimate.
    });
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 55_000);
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 1125,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 100)).toEqual({
      [testbed.rewardAsset.index]: 6200,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 200)).toEqual({
      [testbed.rewardAsset.index]: 8266,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 2000)).toEqual({
      [testbed.rewardAsset.index]: 11_808,
    });

    // Update farm, estimate should include already accrued rewards.
    await testbed.waitRoundsAndUpdateFarm(4);
    userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 500,
    });
    atTime = testbed.farm.state.updatedAt;
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 500,
    });

    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 1000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 600,
    });

    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 10_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 2250,
    });

    // Wait until duration is 0
    await testbed.waitRoundsAndUpdateFarm(4);
    expect(testbed.farm.state.duration).toBe(1);
    expect(testbed.farm.state.nextDuration).toBe(20);

    await testbed.waitRoundsAndUpdateFarm(1);
    expect(testbed.farm.state.duration).toBe(20);
    expect(testbed.farm.state.nextDuration).toBe(0);

    await testbed.waitRoundsAndUpdateFarm(1);
    expect(testbed.farm.state.duration).toBe(19);
    expect(testbed.farm.state.nextDuration).toBe(0);

    await testbed.waitRoundsAndUpdateFarm(19);
    expect(testbed.farm.state.duration).toBe(0);
    expect(testbed.farm.state.nextDuration).toBe(0);

    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 10_000);
    expect(testbed.farm.estimateAccruedRewards(atTime, userState!)).toEqual({
      [testbed.rewardAsset.index]: 6000,
    });

    // Cannot simulate new staker if duration is 0.
    atTime = new Date(testbed.farm.state.updatedAt.getTime() + 10_000);
    expect(testbed.farm.simulateNewStaker(atTime, 0)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.simulateNewStaker(atTime, 10)).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
  });

  it("deposit next rewards", async () => {
    const testbed = await makeFreshFarmingTestbed();

    // Deposit rewards.
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 2000 }, 10);
    expect(testbed.farm.state.pendingRewards).toEqual({
      [testbed.rewardAsset.index]: 2000,
    });
    expect(testbed.farm.state.duration).toEqual(10);
    expect(testbed.farm.state.nextRewards).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.state.nextDuration).toEqual(0);

    // Deposit next rewards.
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 50_000 }, 15);
    expect(testbed.farm.state.pendingRewards).toEqual({
      [testbed.rewardAsset.index]: 2000,
    });
    expect(testbed.farm.state.duration).toEqual(10);
    expect(testbed.farm.state.nextRewards).toEqual({
      [testbed.rewardAsset.index]: 50_000,
    });
    expect(testbed.farm.state.nextDuration).toEqual(15);

    // The farm is paused when there are no stakers.
    await testbed.waitRoundsAndUpdateFarm(5);
    expect(testbed.farm.state.duration).toBe(10);

    // Stake
    await testbed.stake(1000);
    let holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(1000);

    // Wait and check rewards.
    await testbed.waitRoundsAndUpdateFarm(6);
    expect(testbed.farm.state.pendingRewards).toEqual({
      [testbed.rewardAsset.index]: 800,
    });
    expect(testbed.farm.state.duration).toBe(4);
    expect(testbed.farm.state.nextRewards).toEqual({
      [testbed.rewardAsset.index]: 50_000,
    });
    expect(testbed.farm.state.nextDuration).toBe(15);

    // Wait some more time - the first cycle is finished and the second is started.
    await testbed.waitRoundsAndUpdateFarm(10);
    expect(testbed.farm.state.pendingRewards).toEqual({
      [testbed.rewardAsset.index]: 30_000,
    });
    expect(testbed.farm.state.duration).toBe(9);
    expect(testbed.farm.state.nextRewards).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
    expect(testbed.farm.state.nextDuration).toBe(0);

    // Unstake all.
    await testbed.unstake(1000);
    holding = await testbed.stakedAsset.getHolding(testbed.escrow.address);
    expect(holding).toBe(0);

    // Check rewards.
    const userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 25330,
    });

    // Claim rewards.
    await testbed.assertRewards(() => testbed.claim());

    // The farm is paused again.
    await testbed.waitRoundsAndUpdateFarm(5);
    expect(testbed.farm.state.duration).toBe(8);
  });

  it("multiple reward assets", async () => {
    const testbed = await makeFreshFarmingTestbed();

    // Deposit rewards.
    const rewardA = testbed.rewardAsset;
    const rewardB = await testbed.makeAsset("ASA_REW2");
    const rewardC = await testbed.makeAsset("ASA_REW3");
    const rewards = {
      [rewardA.index]: 1000,
      [rewardB.index]: 2000,
      [rewardC.index]: 3000,
    };
    await testbed.depositRewards(rewards, 100);

    // Stake.
    await testbed.stake(100);

    // Wait some rounds.
    await testbed.waitRoundsAndUpdateFarm(10);

    // Check state.
    let userState = await testbed.escrow.fetchUserState();
    expect(userState).toEqual({
      escrowId: testbed.escrow.appId,
      staked: 100,
      accruedRewards: {
        [rewardA.index]: 100,
        [rewardB.index]: 200,
        [rewardC.index]: 300,
      },
      claimedRewards: {
        [rewardA.index]: 0,
        [rewardB.index]: 0,
        [rewardC.index]: 0,
      },
      rpt: { [rewardA.index]: 1.0, [rewardB.index]: 2.0, [rewardC.index]: 3.0 },
    });
    expect(testbed.farm.state.rewardAssets).toEqual([
      rewardA,
      rewardB,
      rewardC,
    ]);
    expect(testbed.farm.state.distributedRewards).toEqual({
      [rewardA.index]: 100,
      [rewardB.index]: 200,
      [rewardC.index]: 300,
    });
    expect(testbed.farm.state.claimedRewards).toEqual({
      [rewardA.index]: 0,
      [rewardB.index]: 0,
      [rewardC.index]: 0,
    });
    expect(testbed.farm.state.pendingRewards).toEqual({
      [rewardA.index]: 900,
      [rewardB.index]: 1800,
      [rewardC.index]: 2700,
    });
    expect(testbed.farm.state.nextRewards).toEqual({
      [rewardA.index]: 0,
      [rewardB.index]: 0,
      [rewardC.index]: 0,
    });
    expect(testbed.farm.state.rpt).toEqual({
      [rewardA.index]: 1.0,
      [rewardB.index]: 2.0,
      [rewardC.index]: 3.0,
    });

    // Claim.
    await testbed.assertRewards(() => testbed.claim());

    // Check state.
    userState = await testbed.escrow.fetchUserState();
    expect(userState).toEqual({
      escrowId: testbed.escrow.appId,
      staked: 100,
      accruedRewards: {
        [rewardA.index]: 0,
        [rewardB.index]: 0,
        [rewardC.index]: 0,
      },
      claimedRewards: {
        [rewardA.index]: 100,
        [rewardB.index]: 200,
        [rewardC.index]: 300,
      },
      rpt: { [rewardA.index]: 1.0, [rewardB.index]: 2.0, [rewardC.index]: 3.0 },
    });
    await updateFarm(testbed.escrow, testbed.userAccount);
    expect(testbed.farm.state.distributedRewards).toEqual({
      [rewardA.index]: 120,
      [rewardB.index]: 240,
      [rewardC.index]: 360,
    });
    expect(testbed.farm.state.claimedRewards).toEqual({
      [rewardA.index]: 100,
      [rewardB.index]: 200,
      [rewardC.index]: 300,
    });
    expect(testbed.farm.state.pendingRewards).toEqual({
      [rewardA.index]: 880,
      [rewardB.index]: 1760,
      [rewardC.index]: 2640,
    });
  });

  it("different reward asset between cycles", async () => {
    const testbed = await makeFreshFarmingTestbed();
    const rewardAssetA = testbed.rewardAsset;
    const rewardAssetB = await testbed.makeAsset("ASA_REW2");

    await testbed.depositRewards({ [rewardAssetA.index]: 1000 }, 10);
    await testbed.depositRewards({ [rewardAssetB.index]: 2000 }, 100);

    // Check the state.
    expect(testbed.farm.state.pendingRewards).toEqual({
      [rewardAssetA.index]: 1000,
      [rewardAssetB.index]: 0,
    });
    expect(testbed.farm.state.duration).toBe(10);
    expect(testbed.farm.state.nextRewards).toEqual({
      [rewardAssetA.index]: 0,
      [rewardAssetB.index]: 2000,
    });
    expect(testbed.farm.state.nextDuration).toBe(100);

    // Stake.
    await testbed.stake(5000);

    // Claim, only the first cycle, one asset is distributed.
    await testbed.waitRoundsAndUpdateFarm(5);
    await testbed.assertRewards(() => testbed.claim());
    let holding = await rewardAssetA.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(499);
    holding = await rewardAssetB.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(0);

    // Claim, cross-cycle, both assets are distributed.
    await testbed.waitRoundsAndUpdateFarm(10);
    await testbed.assertRewards(() => testbed.claim());
    holding = await rewardAssetA.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(998);
    holding = await rewardAssetB.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(119);

    // Claim, second cycle, only the second asset is distributed.
    await testbed.waitRoundsAndUpdateFarm(10);
    await testbed.assertRewards(() => testbed.claim());
    holding = await rewardAssetA.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(998);
    holding = await rewardAssetB.getHolding(testbed.userAccount.addr);
    expect(holding).toBe(338);
  });

  it("multiple stakers", async () => {
    const testbed = await makeFreshFarmingTestbed();

    await testbed.depositRewards({ [testbed.rewardAsset.index]: 150_000 }, 100);

    const [accountA, escrowA] = [testbed.userAccount, testbed.escrow];
    const [accountB, escrowB] = await makeNewAccountAndEscrow(
      testbed.farm,
      testbed.adminAccount,
      [testbed.rewardAsset],
    );
    const [accountC, escrowC] = await makeNewAccountAndEscrow(
      testbed.farm,
      testbed.adminAccount,
      [testbed.rewardAsset],
    );

    const accountsAndEscrows: [algosdk.Account, Escrow][] = [
      [accountA, escrowA],
      [accountB, escrowB],
      [accountC, escrowC],
    ];

    // Stake all 3 users.
    let stakeTxs = escrowA.buildStakeTxs(1000);
    await signAndSend(new TransactionGroup(stakeTxs), accountA);

    stakeTxs = escrowB.buildStakeTxs(2000);
    await signAndSend(new TransactionGroup(stakeTxs), accountB);

    stakeTxs = escrowC.buildStakeTxs(3000);
    await signAndSend(new TransactionGroup(stakeTxs), accountC);

    // Check state.
    await waitRounds(10, accountA);
    await updateFarm(escrowA, accountA);
    await updateFarm(escrowB, accountB);
    await updateFarm(escrowC, accountC);

    expect(testbed.farm.state.numStakers).toBe(3);
    expect(testbed.farm.state.rpt).toEqual({
      [testbed.rewardAsset.index]: 5.25,
    });

    const userAState = (await escrowA.fetchUserState())!;
    const userBstate = (await escrowB.fetchUserState())!;
    const userCstate = (await escrowC.fetchUserState())!;

    expect(userAState.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 4750,
    });
    expect(userAState.rpt).toEqual({ [testbed.rewardAsset.index]: 4.75 });

    expect(userBstate.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 7000,
    });
    expect(userBstate.rpt).toEqual({ [testbed.rewardAsset.index]: 5.0 });

    expect(userCstate.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 9750,
    });
    expect(userCstate.rpt).toEqual({ [testbed.rewardAsset.index]: 5.25 });

    for (const [account, escrow] of accountsAndEscrows) {
      await testbed.assertRewards(
        async () => {
          const claimTx = escrow.buildClaimRewardsTx();
          await signAndSend(claimTx, account);
        },
        { account },
      );
    }

    let holding = await testbed.rewardAsset.getHolding(accountA.addr);
    expect(holding).toBe(4750);
    holding = await testbed.rewardAsset.getHolding(accountB.addr);
    expect(holding).toBe(7000);
    holding = await testbed.rewardAsset.getHolding(accountC.addr);
    expect(holding).toBe(9750);

    holding = await testbed.rewardAsset.getHolding(testbed.farm.appAddress);
    expect(holding).toBe(150_000 - 4750 - 7000 - 9750);
  });

  it("algo rewards", async () => {
    const algo = getAlgo(algod);
    const testbed = await makeFreshFarmingTestbed();

    // Deposit algo as rewards.
    await testbed.depositRewards({ [algo.index]: 500 }, 10);
    expect(testbed.farm.state.rewardAssets).toEqual([algo]);
    expect(testbed.farm.state.pendingRewards).toEqual({ [algo.index]: 500 });

    // Stake.
    await testbed.stake(1000);

    // Claim.
    await testbed.waitRoundsAndUpdateFarm(3);
    await testbed.assertRewards(() => testbed.claim());
    await updateFarm(testbed.escrow, testbed.userAccount);
    expect(testbed.farm.state.pendingRewards).toEqual({ [algo.index]: 250 });

    // Let's mix algo and ASA in the next cycle.
    const rewardAsset = await testbed.makeAsset("ASA_REW");
    await testbed.depositRewards(
      { [algo.index]: 1000, [rewardAsset.index]: 20_000 },
      10,
    );
    expect(testbed.farm.state.rewardAssets).toEqual([algo, rewardAsset]);
    expect(testbed.farm.state.pendingRewards).toEqual({
      [algo.index]: 100,
      [rewardAsset.index]: 0,
    });
    expect(testbed.farm.state.nextRewards).toEqual({
      [algo.index]: 1000,
      [rewardAsset.index]: 20_000,
    });

    // Claim.
    await testbed.waitRoundsAndUpdateFarm(5);
    const userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [algo.index]: 648,
      [rewardAsset.index]: 6_000,
    });
    await testbed.assertRewards(() => testbed.claim());
    await updateFarm(testbed.escrow, testbed.userAccount);
    expect(testbed.farm.state.pendingRewards).toEqual({
      [algo.index]: 500,
      [rewardAsset.index]: 10_000,
    });
  });

  it("stake for longer then farm duration", async () => {
    const testbed = await makeFreshFarmingTestbed();
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 1000 }, 5);
    await testbed.stake(100);

    await testbed.waitRoundsAndUpdateFarm(10);
    expect(testbed.farm.state.duration).toBe(0);
    let userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 1000,
    });
    expect(userState!.staked).toBe(100);

    // Check if unstake and claim are still working.
    await testbed.unstake(100);
    await testbed.assertRewards(() => testbed.claim());
    const holding = await testbed.rewardAsset.getHolding(
      testbed.userAccount.addr,
    );
    expect(holding).toBe(1000);

    // Should be able to stake again but no rewards accruing.
    await testbed.stake(100);
    await testbed.waitRoundsAndUpdateFarm(5);
    userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 0,
    });
  });

  it("claim only selected assets", async () => {
    const testbed = await makeFreshFarmingTestbed();
    const rewardAssetA = testbed.rewardAsset;
    const rewardAssetB = await testbed.makeAsset("ASA_REW2");
    await testbed.depositRewards(
      { [rewardAssetA.index]: 500, [rewardAssetB.index]: 1000 },
      100,
    );
    await testbed.stake(1000);

    await testbed.waitRoundsAndUpdateFarm(5);
    let userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [rewardAssetA.index]: 24,
      [rewardAssetB.index]: 49,
    });

    // Claim only a single asset.
    let claimTx = testbed.farm.buildClaimRewardsTx(testbed.escrow, [
      rewardAssetB,
    ]);
    await signAndSend(claimTx, testbed.userAccount);
    userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [rewardAssetA.index]: 24,
      [rewardAssetB.index]: 0,
    });

    // Claim the other asset.
    claimTx = testbed.farm.buildClaimRewardsTx(testbed.escrow, [rewardAssetA]);
    await signAndSend(claimTx, testbed.userAccount);
    userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [rewardAssetA.index]: 0,
      [rewardAssetB.index]: 0,
    });
  });

  it("two users joining at different time", async () => {
    const testbed = await makeFreshFarmingTestbed();
    const [accountA, escrowA] = [testbed.userAccount, testbed.escrow];
    const [accountB, escrowB] = await makeNewAccountAndEscrow(
      testbed.farm,
      testbed.adminAccount,
      [testbed.rewardAsset],
    );

    await testbed.depositRewards({ [testbed.rewardAsset.index]: 10_000 }, 100);

    let stakeTxs = escrowA.buildStakeTxs(10);
    await signAndSend(new TransactionGroup(stakeTxs), accountA);

    await waitRounds(10, accountA);
    stakeTxs = escrowB.buildStakeTxs(1000);
    await signAndSend(new TransactionGroup(stakeTxs), accountB);

    await waitRounds(10, accountA);

    let updateTxs = testbed.farm.buildUpdateWithOpcodeIncreaseTxs(escrowA);
    await signAndSend(new TransactionGroup(updateTxs), accountA);

    updateTxs = testbed.farm.buildUpdateWithOpcodeIncreaseTxs(escrowB);
    await signAndSend(new TransactionGroup(updateTxs), accountB);

    // First user takes all rewards for first 10(+1) seconds and only a little for the next 10.
    const userStateA = await escrowA.fetchUserState();
    expect(userStateA!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 1110,
    });

    // Second user takes most rewards for the second 10(+2) seconds.
    const userStateB = await escrowB.fetchUserState();
    expect(userStateB!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 1188,
    });
  });

  it("deposit rewards with active stakers", async () => {
    const testbed = await makeFreshFarmingTestbed();

    // First stake.
    await testbed.stake(1000);

    // Then add rewards.
    await waitRounds(5, testbed.userAccount);
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 100 }, 10);

    // Should accrue rewards only for the last round.
    await updateFarm(testbed.escrow, testbed.userAccount);
    let userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 9,
    });

    // Should accrue all rewards.
    await testbed.waitRoundsAndUpdateFarm(10);
    await waitRounds(10, testbed.userAccount);
    userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 98,
    });
    await testbed.assertRewards(() => testbed.claim());

    // Deposit more rewards.
    await testbed.waitRoundsAndUpdateFarm(5);
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 100 }, 10);

    // Should accrue only the last round.
    await updateFarm(testbed.escrow, testbed.userAccount);
    userState = await testbed.escrow.fetchUserState();
    expect(userState!.accruedRewards).toEqual({
      [testbed.rewardAsset.index]: 9,
    });
  });

  it("fetch assets", async () => {
    const testbed = await makeFreshFarmingTestbed();
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 1000 }, 100);

    Asset.assetsCache = {};

    // Full assets info is not fetched by default to minimize requests to algod.
    const farm = await testbed.pact.farming.fetchFarmById(testbed.farm.appId);
    expect(farm.stakedAsset.unitName).toBe("");
    expect(farm.state.rewardAssets[0].unitName).toBe("");

    await farm.fetchAllAssets();
    expect(farm.stakedAsset.unitName).toBe("ASA_STK");
    expect(farm.state.rewardAssets[0].unitName).toBe("ASA_REW");
  });

  it("no testbed", async () => {
    // No testbed here so everything is more explicit.
    const adminAccount = await newAccount();
    const pact = new PactClient(algod);

    const stakedAsset = await pact.fetchAsset(
      await createAsset(adminAccount, "ASA_STK"),
    );
    const rewardAsset = await pact.fetchAsset(
      await createAsset(adminAccount, "ASA_REW"),
    );

    // Deploy farm.
    const farmId = await deployFarm(adminAccount, stakedAsset.index);
    const suggestedParams = await algod.getTransactionParams().do();
    const farm = await pact.farming.fetchFarmById(farmId);
    farm.setSuggestedParams(suggestedParams);
    const fundAlgoTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: adminAccount.addr,
      to: farm.appAddress,
      amount: 100_000,
      suggestedParams,
    });
    await signAndSend(fundAlgoTx, adminAccount);

    // Deposit await rewards
    const depositRewardsTxs = farm.adminBuildDepositRewardsTxs(
      { [rewardAsset.index]: 1000 },
      100,
    );
    await signAndSend(new TransactionGroup(depositRewardsTxs), adminAccount);

    // Make user account.
    const userAccount = await makeNewAccountForFarm(farm, adminAccount, [
      rewardAsset,
    ]);

    // Check that the user doesn't have an escrow.
    let escrow = await farm.fetchEscrowByAddress(userAccount.addr);
    expect(escrow).toBeNull();

    // Deploy an escrow.
    const deployTxs = await farm.prepareDeployEscrowTxs(userAccount.addr);
    await signAndSend(new TransactionGroup(deployTxs), userAccount);
    const txinfo: any = await algod
      .pendingTransactionInformation(deployTxs[1].txID())
      .do();
    const escrowId = txinfo["application-index"];
    escrow = await farm.fetchEscrowById(escrowId);
    expect(escrow).not.toBeNull();
    await escrow.refreshSuggestedParams();

    // Stake.
    const stakeTxs = escrow.buildStakeTxs(100);
    await signAndSend(new TransactionGroup(stakeTxs), userAccount);

    // Wait some time.
    await waitRounds(5, userAccount);

    // Unstake and claim in a single group.
    const unstake_txs = escrow.buildUnstakeTxs(100);
    const claimTx = escrow.buildClaimRewardsTx();
    const group = new TransactionGroup([...unstake_txs, claimTx]);
    await signAndSend(group, userAccount);

    // Check if the rewards were actually sent.
    const holding = await rewardAsset.getHolding(userAccount.addr);
    expect(holding).toBe(59);
  });

  it("governance", async () => {
    const testbed = await makeFreshFarmingTestbed();
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 2000 }, 100);

    await testbed.stake(1000);

    await testbed.farm.updateState();
    expect(testbed.farm.state.totalStaked).toBe(1000);

    // Commit to governance
    const sendMessageTx = testbed.escrow.buildSendMessageTx(
      testbed.adminAccount.addr,
      "some message required by the Foundation",
    );
    await signAndSend(sendMessageTx, testbed.userAccount);

    // Simulate governance reward.
    const transferTx = testbed.algo.buildTransferTx(
      testbed.adminAccount.addr,
      testbed.escrow.address,
      100,
      testbed.escrow.suggestedParams,
    );
    await signAndSend(transferTx, testbed.adminAccount);

    const escrowAlgos = await testbed.algo.getHolding(testbed.escrow.address);
    const userAlgos = await testbed.algo.getHolding(testbed.userAccount.addr);

    // Withdraw reward.
    const withdrawTx = testbed.escrow.buildWithdrawAlgos();
    await signAndSend(withdrawTx, testbed.userAccount);

    expect(await testbed.algo.getHolding(testbed.escrow.address)).toBe(
      escrowAlgos! - 100,
    );
    expect(await testbed.algo.getHolding(testbed.userAccount.addr)).toBe(
      userAlgos! + 100 - 2000,
    );
  });

  it("exit and delete", async () => {
    const testbed = await makeFreshFarmingTestbed();
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 1000 }, 100);

    await testbed.stake(1_000_000);
    await testbed.waitRoundsAndUpdateFarm(5);
    expect(testbed.farm.state.distributedRewards).toEqual({
      [testbed.rewardAsset.index]: 50,
    });

    expect(testbed.farm.state.totalStaked).toBe(1_000_000);
    expect(testbed.farm.state.numStakers).toBe(1);

    expect(await testbed.stakedAsset.getHolding(testbed.escrow.address)).toBe(
      1_000_000,
    );
    expect(await testbed.algo.getHolding(testbed.escrow.address)).toBe(200_000);

    // Claim and unstake are required before exiting.
    const unstakeTxs = testbed.escrow.buildUnstakeTxs(1_000_000);
    const claim_tx = testbed.escrow.buildClaimRewardsTx();
    await signAndSend(
      new TransactionGroup([...unstakeTxs, claim_tx]),
      testbed.userAccount,
    );

    const userAlgoAmount = await testbed.algo.getHolding(
      testbed.userAccount.addr,
    );

    // Close out and delete the micro farm.
    const exitTx = testbed.escrow.buildExitTx();
    const deleteTx = testbed.escrow.buildDeleteTx();
    const exitAndDeleteGroup = new TransactionGroup([exitTx, deleteTx]);
    await signAndSend(exitAndDeleteGroup, testbed.userAccount);

    // Make sure the escrow address is cleared.
    expect(
      await testbed.stakedAsset.getHolding(testbed.escrow.address),
    ).toBeNull();
    expect(await testbed.algo.getHolding(testbed.escrow.address)).toBe(0);

    // Make sure all algos are claimed by the user account.
    expect(await testbed.algo.getHolding(testbed.userAccount.addr)).toBe(
      userAlgoAmount! + 200_000 - 4000, // + locked amount - fee
    );
  });

  it("force exit and delete", async () => {
    const testbed = await makeFreshFarmingTestbed();
    await testbed.depositRewards({ [testbed.rewardAsset.index]: 1000 }, 100);

    await testbed.stake(1_000_000);
    await testbed.waitRoundsAndUpdateFarm(5);
    expect(testbed.farm.state.distributedRewards).toEqual({
      [testbed.rewardAsset.index]: 50,
    });

    expect(testbed.farm.state.totalStaked).toBe(1_000_000);
    expect(testbed.farm.state.numStakers).toBe(1);

    expect(await testbed.stakedAsset.getHolding(testbed.escrow.address)).toBe(
      1_000_000,
    );
    expect(await testbed.algo.getHolding(testbed.escrow.address)).toBe(200_000);

    const userAlgoAmount = await testbed.algo.getHolding(
      testbed.userAccount.addr,
    );
    const userStakedAmount = await testbed.stakedAsset.getHolding(
      testbed.userAccount.addr,
    );

    // Close out and delete the micro farm. Unstake is not required when doing forceExit.
    const exitTx = testbed.escrow.buildForceExitTx();
    const deleteTx = testbed.escrow.buildDeleteTx();
    const exitAndDeleteGroup = new TransactionGroup([exitTx, deleteTx]);
    await signAndSend(exitAndDeleteGroup, testbed.userAccount);

    // Make sure the escrow address is cleared.
    expect(
      await testbed.stakedAsset.getHolding(testbed.escrow.address),
    ).toBeNull();
    expect(await testbed.algo.getHolding(testbed.escrow.address)).toBe(0);

    // Make sure all algos and staked tokens are claimed by the user account.
    expect(await testbed.algo.getHolding(testbed.userAccount.addr)).toBe(
      userAlgoAmount! + 200_000 - 4000, // + locked amount - fee
    );
    expect(await testbed.stakedAsset.getHolding(testbed.userAccount.addr)).toBe(
      userStakedAmount! + 1_000_000,
    );
  });

  it("haveRewards()", async () => {
    const testbed = await makeFreshFarmingTestbed();
    expect(testbed.farm.haveRewards()).toBe(false);

    await testbed.depositRewards({ [testbed.rewardAsset.index]: 100 }, 10);
    expect(testbed.farm.haveRewards()).toBe(true);

    // Farm is freezed.
    let dt = new Date(testbed.farm.state.updatedAt.getTime() + 20_000);
    expect(testbed.farm.haveRewards(dt)).toBe(true);

    await testbed.stake(10);
    await updateFarm(testbed.escrow, testbed.userAccount);
    dt = new Date(testbed.farm.state.updatedAt.getTime() + 5_000);
    expect(testbed.farm.haveRewards(dt)).toBe(true);

    dt = new Date(testbed.farm.state.updatedAt.getTime() + 8_000);
    expect(testbed.farm.haveRewards(dt)).toBe(true);

    dt = new Date(testbed.farm.state.updatedAt.getTime() + 9_000);
    expect(testbed.farm.haveRewards(dt)).toBe(false);

    dt = new Date(testbed.farm.state.updatedAt.getTime() + 20_000);
    expect(testbed.farm.haveRewards(dt)).toBe(false);

    // Farm is finished.
    await testbed.waitRoundsAndUpdateFarm(10);
    expect(testbed.farm.haveRewards()).toBe(false);
  });
});
