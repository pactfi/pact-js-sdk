import algosdk from "algosdk";

import { Asset } from "./asset";
import { PactClient } from "./client";
import { Pool, PoolType } from "./pool";
import {
  algod,
  createAsset,
  deployContract,
  newAccount,
  signAndSend,
} from "./testUtils";

export function deployConstantProductContract(
  account: algosdk.Account,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
  options: {
    feeBps?: number;
    pactFeeBps?: number;
  } = {},
) {
  return deployExchangeContract(
    account,
    "CONSTANT_PRODUCT",
    primaryAssetIndex,
    secondaryAssetIndex,
    options,
  );
}

export function deployStableswapContract(
  account: algosdk.Account,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
  options: {
    feeBps?: number;
    pactFeeBps?: number;
    amplifier?: number;
    version?: number;
  } = {},
) {
  return deployExchangeContract(
    account,
    "STABLESWAP",
    primaryAssetIndex,
    secondaryAssetIndex,
    options,
  );
}

export function deployExchangeContract(
  account: algosdk.Account,
  poolType: PoolType,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
  options: {
    feeBps?: number;
    pactFeeBps?: number;
    amplifier?: number;
    version?: number;
  } = {},
) {
  const command = [
    "exchange",
    `--contract-type=${poolType.toLowerCase()}`,
    `--primary_asset_id=${primaryAssetIndex}`,
    `--secondary_asset_id=${secondaryAssetIndex}`,
    `--fee_bps=${options.feeBps ?? 30}`,
    `--pact_fee_bps=${options.pactFeeBps ?? 0}`,
    `--amplifier=${(options.amplifier ?? 80) * 1000}`,
    `--admin_and_treasury_address=${account.addr}`,
  ];

  if (options.version) {
    command.push(`--version=${options.version}`);
  }

  return deployContract(account, command);
}

export async function addLiquidity(
  account: algosdk.Account,
  pool: Pool,
  primaryAssetAmount = 10_000,
  secondaryAssetAmount = 10_000,
) {
  const optInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
  await signAndSend(optInTx, account);

  const liquidityAddition = pool.prepareAddLiquidity({
    primaryAssetAmount,
    secondaryAssetAmount,
  });
  const addLiqTxGroup = await liquidityAddition.prepareTxGroup(account.addr);
  await signAndSend(addLiqTxGroup, account);
  await pool.updateState();
}

export type PoolTestBed = {
  account: algosdk.Account;
  pact: PactClient;
  algo: Asset;
  coin: Asset;
  pool: Pool;
};

export async function makeFreshPoolTestbed(
  options: {
    poolType?: PoolType;
    feeBps?: number;
    pactFeeBps?: number;
    amplifier?: number;
    version?: number;
  } = {},
): Promise<PoolTestBed> {
  const account = await newAccount();
  const pact = new PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const coinIndex = await createAsset(account);
  const coin = await pact.fetchAsset(coinIndex);

  const poolType = options.poolType ?? "CONSTANT_PRODUCT";

  const appId = await deployExchangeContract(
    account,
    poolType,
    algo.index,
    coin.index,
    {
      feeBps: options.feeBps,
      pactFeeBps: options.pactFeeBps,
      amplifier: options.amplifier,
      version: options.version,
    },
  );

  const pool = await pact.fetchPoolById(appId);

  return { account, pact, algo, coin, pool };
}
