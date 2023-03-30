import algosdk from "algosdk";

import { Asset, getAlgo } from "../asset";
import { PactClient } from "../client";
import { getGasStation } from "../gasStation";
import {
  algod,
  createAsset,
  deployContract,
  newAccount,
  signAndSend,
  waitRounds,
} from "../testUtils";
import { TransactionGroup } from "../transactionGroup";
import {
  Escrow,
  buildDeployEscrowTxs,
  fetchEscrowApprovalProgram,
} from "./escrow";
import { Farm } from "./farm";
import { FarmingRewards } from "./farmState";

export type AssertRewardsOptions = {
  rewards?: FarmingRewards;
  account?: algosdk.Account;
};

export function deployFarm(account: algosdk.Account, stakedAssetId: number) {
  return deployContract(account, [
    "farm",
    `--staked-asset-id=${stakedAssetId}`,
    `--gas-station-id=${getGasStation().appId}`,
    `--admin=${account.addr}`,
  ]);
}

export class FarmingTestBed {
  constructor(
    public adminAccount: algosdk.Account,
    public userAccount: algosdk.Account,
    public pact: PactClient,
    public algo: Asset,
    public stakedAsset: Asset,
    public rewardAsset: Asset,
    public farm: Farm,
    public escrow: Escrow,
  ) {}

  async waitRoundsAndUpdateFarm(rounds: number) {
    await waitRounds(rounds - 1, this.userAccount);
    await updateFarm(this.escrow, this.userAccount);
  }

  async depositRewards(rewards: FarmingRewards, duration: number) {
    const depositRewardsTxs = this.farm.adminBuildDepositRewardsTxs(
      rewards,
      duration,
    );
    const group = new TransactionGroup(depositRewardsTxs);
    await signAndSend(group, this.adminAccount);
    await this.farm.updateState();
  }

  stake(amount: number) {
    const stakeTxs = this.escrow.buildStakeTxs(amount);
    return signAndSend(new TransactionGroup(stakeTxs), this.userAccount);
  }

  unstake(amount: number) {
    const unstakeTxs = this.escrow.buildUnstakeTxs(amount);
    return signAndSend(new TransactionGroup(unstakeTxs), this.userAccount);
  }

  claim() {
    const claimTx = this.escrow.buildClaimRewardsTx();
    return signAndSend(claimTx, this.userAccount);
  }

  async makeAsset(name: string) {
    const assetIndex = await createAsset(this.adminAccount, (name = name));
    const asset = await this.pact.fetchAsset(assetIndex);
    const optinTx = asset.buildOptInTx(
      this.userAccount.addr,
      this.farm.suggestedParams,
    );
    await signAndSend(optinTx, this.userAccount);
    return asset;
  }

  async assertRewards(
    callback: () => Promise<any>,
    options: AssertRewardsOptions = {},
  ) {
    const account = options.account ?? this.userAccount;
    const rewards =
      options.rewards ??
      (await this.farm.fetchUserState(account.addr))?.accruedRewards;

    if (!rewards) {
      throw Error("No user rewards.");
    }

    const oldUserBalance = await fetchUserAssetsBalance(this.farm, account);

    await callback();

    const newUserBalance = await fetchUserAssetsBalance(this.farm, account);
    const allAssets = [...this.farm.state.rewardAssets, this.farm.stakedAsset];
    for (const asset of allAssets) {
      if (asset.index === 0) {
        // Cannot test ALGO in a reliable way because of farm rewards being distributed.
        continue;
      }
      const expectedAmount =
        (oldUserBalance[asset.index] ?? 0) + (rewards[asset.index] ?? 0);
      const amount = newUserBalance[asset.index] ?? 0;
      if (amount !== expectedAmount) {
        throw Error(
          `Expected ${expectedAmount} ${asset}, got ${amount} ${asset}.`,
        );
      }
    }
  }
}

export async function makeFreshFarmingTestbed() {
  const adminAccount = await newAccount();
  const pact = new PactClient(algod);

  const algo = getAlgo(algod);

  const stakedAsset = await pact.fetchAsset(
    await createAsset(adminAccount, "ASA_STK"),
  );
  const rewardAsset = await pact.fetchAsset(
    await createAsset(adminAccount, "ASA_REW"),
  );

  const suggestedParams = await algod.getTransactionParams().do();

  const farmId = await deployFarm(adminAccount, stakedAsset.index);
  const farm = await pact.farming.fetchFarmById(farmId);
  farm.setSuggestedParams(suggestedParams);

  const fundAlgoTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: adminAccount.addr,
    to: farm.appAddress,
    amount: 100_000,
    suggestedParams,
  });
  await signAndSend(fundAlgoTx, adminAccount);

  const [userAccount, escrow] = await makeNewAccountAndEscrow(
    farm,
    adminAccount,
    [rewardAsset],
  );

  return new FarmingTestBed(
    adminAccount,
    userAccount,
    pact,
    algo,
    stakedAsset,
    rewardAsset,
    farm,
    escrow,
  );
}

export async function makeNewAccountAndEscrow(
  farm: Farm,
  adminAccount: algosdk.Account,
  rewardAssets: Asset[],
): Promise<[algosdk.Account, Escrow]> {
  const userAccount = await makeNewAccountForFarm(
    farm,
    adminAccount,
    rewardAssets,
  );

  const escrow = await deployEscrowForAccount(
    farm,
    userAccount,
    farm.suggestedParams,
  );
  escrow.setSuggestedParams(farm.suggestedParams);

  return [userAccount, escrow];
}

export async function makeNewAccountForFarm(
  farm: Farm,
  adminAccount: algosdk.Account,
  rewardAssets: Asset[],
) {
  const userAccount = await newAccount();

  // Opt-in user to assets.
  for (const asset of [farm.stakedAsset, ...rewardAssets]) {
    if (asset.index !== 0) {
      const optinTx = asset.buildOptInTx(
        userAccount.addr,
        farm.suggestedParams,
      );
      await signAndSend(optinTx, userAccount);
    }
  }

  // Transfer staking asset to the user.
  const transferTx = farm.stakedAsset.buildTransferTx(
    adminAccount.addr,
    userAccount.addr,
    1_000_000,
    farm.suggestedParams,
  );
  await signAndSend(transferTx, adminAccount);

  return userAccount;
}

export async function deployEscrowForAccount(
  farm: Farm,
  userAccount: algosdk.Account,
  suggestedParams: algosdk.SuggestedParams,
): Promise<Escrow> {
  const escrowApprovalProgram = await fetchEscrowApprovalProgram(
    algod,
    farm.appId,
  );
  const deployTxs = buildDeployEscrowTxs(
    userAccount.addr,
    farm.appId,
    farm.stakedAsset.index,
    escrowApprovalProgram,
    suggestedParams,
  );
  await signAndSend(new TransactionGroup(deployTxs), userAccount);
  const txinfo = await algod
    .pendingTransactionInformation(deployTxs[1].txID())
    .do();
  const appId = txinfo["application-index"];

  return farm.fetchEscrowById(appId);
}

export async function updateFarm(escrow: Escrow, account: algosdk.Account) {
  await escrow.refreshSuggestedParams();

  const updateTxs = escrow.farm.buildUpdateWithOpcodeIncreaseTxs(escrow);
  await signAndSend(new TransactionGroup(updateTxs), account);

  await escrow.farm.updateState();
  await escrow.farm.refreshSuggestedParams();
}

export async function fetchUserAssetsBalance(
  farm: Farm,
  account: algosdk.Account,
): Promise<Record<number, number>> {
  const balances: Record<number, number> = {};
  for (const asset of [...farm.state.rewardAssets, farm.stakedAsset]) {
    balances[asset.index] = (await asset.getHolding(account.addr)) ?? 0;
  }
  return balances;
}
