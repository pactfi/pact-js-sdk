import "process";

import fs from "fs/promises";

import algosdk from "algosdk";

import { Asset } from "./asset";
import { PactClient } from "./client";
import { encodeArray } from "./encoding";
import { FolksLendingPoolAdapter } from "./folksLendingPool";
import { deployExchangeContract } from "./testPoolUtils";
import {
  ROOT_ACCOUNT,
  algod,
  createAsset,
  deployContract,
  newAccount,
  signAndSend,
  waitRounds,
} from "./testUtils";
import { TransactionGroup } from "./transactionGroup";
import { getLastRound, spFee } from "./utils";

const PROGRAMS_CACHE: Record<string, Uint8Array> = {};

async function getProgram(tealPath: string): Promise<string> {
  return await fs.readFile(`${process.cwd()}/${tealPath}`, {
    encoding: "utf8",
  });
}

async function getCompiledProgram(tealPath: string): Promise<Uint8Array> {
  if (!PROGRAMS_CACHE[tealPath]) {
    const program = await getProgram(tealPath);
    const response = await algod.compile(program).do();
    const buffer = Buffer.from(response["result"], "base64");
    PROGRAMS_CACHE[tealPath] = new Uint8Array(buffer);
  }
  return PROGRAMS_CACHE[tealPath];
}

async function deploy_folks_manager(): Promise<number> {
  const sp = await algod.getTransactionParams().do();

  const emptyProgram = await getCompiledProgram("contract-mocks/empty.teal");

  const createTx = algosdk.makeApplicationCreateTxnFromObject({
    from: ROOT_ACCOUNT.addr,
    suggestedParams: spFee(sp, 2000),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: emptyProgram,
    clearProgram: emptyProgram,
    numGlobalInts: 0,
    numGlobalByteSlices: 0,
    numLocalByteSlices: 0,
    numLocalInts: 0,
  });

  const tx = await signAndSend(createTx, ROOT_ACCOUNT);

  const txinfo = await algod.pendingTransactionInformation(tx.txId).do();
  return txinfo["application-index"];
}

export type FolksLendingPoolDeployOptions = {
  originalAssetId: number;
  managerId: number;
  interestRate: number;
  interestIndex: number;
  updatedAt: number;
};

async function deployFolksLendingPool(
  options: FolksLendingPoolDeployOptions,
): Promise<number> {
  const sp = await algod.getTransactionParams().do();

  const approvalProgram = await getCompiledProgram(
    "contract-mocks/folks_lending_pool_mock.teal",
  );

  const clearProgram = await getCompiledProgram("contract-mocks/empty.teal");

  const createTx = algosdk.makeApplicationCreateTxnFromObject({
    from: ROOT_ACCOUNT.addr,
    suggestedParams: spFee(sp, 1000),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    numGlobalInts: 1,
    numGlobalByteSlices: 3,
    numLocalInts: 0,
    numLocalByteSlices: 0,
  });
  const tx = await signAndSend(createTx, ROOT_ACCOUNT);
  const txinfo = await algod.pendingTransactionInformation(tx.txId).do();
  const appId: number = txinfo["application-index"];

  // Fund the contract.
  const fundTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: ROOT_ACCOUNT.addr,
    amount: 300_000,
    to: algosdk.getApplicationAddress(appId),
    suggestedParams: sp,
  });

  const initAppArgs = encodeArray([
    "init",
    options.managerId,
    options.interestRate,
    options.interestIndex,
    options.updatedAt,
  ]);

  // Init the app.
  const initTx = algosdk.makeApplicationNoOpTxnFromObject({
    from: ROOT_ACCOUNT.addr,
    suggestedParams: spFee(sp, 3000),
    appIndex: appId,
    appArgs: initAppArgs,
    foreignAssets: options.originalAssetId ? [options.originalAssetId] : [],
  });

  const group = new TransactionGroup([fundTx, initTx]);
  await signAndSend(group, ROOT_ACCOUNT);

  return appId;
}

function deployLendingPoolAdapter() {
  return deployContract(ROOT_ACCOUNT, ["lending-pool-adapter"]);
}

export class LendingPoolAdapterTestBed {
  constructor(
    public account: algosdk.Account,
    public pact: PactClient,
    public algo: Asset,
    public originalAsset: Asset,
    public lendingPoolAdapter: FolksLendingPoolAdapter,
  ) {}

  async addLiquidity(
    primaryAssetAmount: number,
    secondaryAssetAmount: number,
    slippagePct = 0,
  ) {
    const lendingLiquidityAddition =
      await this.lendingPoolAdapter.prepareAddLiquidity({
        primaryAssetAmount,
        secondaryAssetAmount,
        slippagePct,
      });
    const txGroup = await this.lendingPoolAdapter.prepareAddLiquidityTxGroup({
      address: this.account.addr,
      liquidityAddition: lendingLiquidityAddition,
    });
    await signAndSend(txGroup, this.account);
    await this.lendingPoolAdapter.pactPool.updateState();
  }
}

export async function makeFreshLendingPoolTestbed(): Promise<LendingPoolAdapterTestBed> {
  const user = await newAccount();

  const originalAssetId = await createAsset(user, {
    name: "USDC Coin",
    unitName: "USDC",
  });

  const managerId = await deploy_folks_manager();

  await waitRounds(10, user);
  const updatedAt = (await getLastRound(algod)) - 10;

  // Simulates Folks mainnet Algo pool (147169673).
  const primaryLendingPoolId = await deployFolksLendingPool({
    originalAssetId: 0,
    managerId,
    interestIndex: 103440176304992,
    interestRate: 6229129240500989,
    updatedAt: updatedAt,
  });

  // Simulates Folks mainnet USDC pool (147170678).
  const secondaryLendingPoolId = await deployFolksLendingPool({
    originalAssetId,
    managerId,
    interestIndex: 100278968447135,
    interestRate: 44080950253372,
    updatedAt: updatedAt,
  });

  const lendingPoolAdapterId = await deployLendingPoolAdapter();

  const pact = new PactClient(algod, {
    folksLendingPoolAdapterId: lendingPoolAdapterId,
  });

  const primaryLendingPool = await pact.fetchFolksLendingPool(
    primaryLendingPoolId,
  );
  const secondaryLendingPool = await pact.fetchFolksLendingPool(
    secondaryLendingPoolId,
  );

  const pactPoolId = await deployExchangeContract(
    user,
    "CONSTANT_PRODUCT",
    primaryLendingPool.fAsset.index,
    secondaryLendingPool.fAsset.index,
  );
  const pactPool = await pact.fetchPoolById(pactPoolId);

  const lendingPoolAdapter = pact.getFolksLendingPoolAdapter({
    pactPool,
    primaryLendingPool,
    secondaryLendingPool,
  });

  // Opt in adapter to assets.
  const assetIds = [
    primaryLendingPool.originalAsset.index,
    secondaryLendingPool.originalAsset.index,
    primaryLendingPool.fAsset.index,
    secondaryLendingPool.fAsset.index,
    pactPool.liquidityAsset.index,
  ];
  const txGroup = await lendingPoolAdapter.prepareOptInToAssetTxGroup({
    address: user.addr,
    assetIds,
  });
  await signAndSend(txGroup, user);

  // Opt in user to LP token.
  const optInTx = await pactPool.liquidityAsset.prepareOptInTx(user.addr);
  await signAndSend(optInTx, user);

  const lastRound = await getLastRound(algod);
  primaryLendingPool.lastTimestamp = lastRound;
  secondaryLendingPool.lastTimestamp = lastRound;

  return new LendingPoolAdapterTestBed(
    user,
    pact,
    await pact.fetchAsset(0),
    await pact.fetchAsset(originalAssetId),
    lendingPoolAdapter,
  );
}
