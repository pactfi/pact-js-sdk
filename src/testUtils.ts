import { exec } from "child_process";

import algosdk from "algosdk";

import { Asset } from "./asset";
import { PactClient } from "./client";
import { Pool, PoolType } from "./pool";
import { TransactionGroup } from "./transactionGroup";

export const ROOT_ACCOUNT = algosdk.mnemonicToSecretKey(
  "jelly swear alcohol hybrid wrong camp prize attack hurdle shaft solar entry inner arm region economy awful inch they squirrel sort renew legend absorb giant",
);

export const algod = new algosdk.Algodv2(
  "8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3",
  "http://localhost",
  8787,
);

export async function signAndSend(
  txToSend: algosdk.Transaction | TransactionGroup,
  account: algosdk.Account,
) {
  const signedTx = txToSend.signTxn(account.sk);
  return await algod.sendRawTransaction(signedTx).do();
}

export async function createAsset(
  account: algosdk.Account,
  name: string | undefined = "COIN",
  decimals = 6,
  totalIssuance = 100_000_000,
): Promise<number> {
  const suggestedParams = await algod.getTransactionParams().do();

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParams(
    account.addr,
    undefined, // note
    BigInt(totalIssuance),
    decimals,
    false, // defaultFrozen
    account.addr, // manager
    account.addr, // reserve
    account.addr, // freeze
    account.addr, // clawback
    name, // unitName
    name, // assetName
    "", // assetURL
    "", // assetMetadataHash
    suggestedParams,
  );

  const tx = await signAndSend(txn, account);
  const ptx = await algod.pendingTransactionInformation(tx.txId).do();
  return ptx["asset-index"];
}

export function deployExchangeContract(
  account: algosdk.Account,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
  options: {
    feeBps?: number;
  } = {},
) {
  return deployContract(
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
  } = {},
) {
  return deployContract(
    account,
    "STABLESWAP",
    primaryAssetIndex,
    secondaryAssetIndex,
    options,
  );
}

export function deployContract(
  account: algosdk.Account,
  poolType: PoolType,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
  options: {
    feeBps?: number;
    pactFeeBps?: number;
    amplifier?: number;
  } = {},
): Promise<number> {
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  const command = `
    cd algorand-testbed && \\
    ALGOD_URL=http://localhost:8787 \\
    ALGOD_TOKEN=8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3 \\
    DEPLOYER_MNEMONIC="${mnemonic}" \\
    poetry run python scripts/deploy.py \\
   --contract-type=${poolType.toLowerCase()} \\
   --primary_asset_id=${primaryAssetIndex} \\
   --secondary_asset_id=${secondaryAssetIndex} \\
   --fee_bps=${options.feeBps ?? 30} \\
   --pact_fee_bps=${options.pactFeeBps ?? 30} \\
   --amplifier=${options.amplifier ?? 80} \\
   --admin_and_treasury_address=${account.addr}
   `;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error.message);
        return;
      }
      if (stderr) {
        reject(stderr);
        return;
      }
      const idRegex = /EC ID: (\d+)/;
      const match = idRegex.exec(stdout);
      if (!match) {
        reject("Can't find app id in std out.");
        return;
      }

      resolve(parseInt(match[1]));
    });
  });
}

export async function addLiqudity(
  account: algosdk.Account,
  pool: Pool,
  primaryAssetAmount = 10_000,
  secondaryAssetAmount = 10_000,
) {
  const optInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
  await signAndSend(optInTx, account);

  const addLiqTxGroup = await pool.prepareAddLiquidityTxGroup({
    address: account.addr,
    primaryAssetAmount,
    secondaryAssetAmount,
  });
  await signAndSend(addLiqTxGroup, account);
  await pool.updateState();
}

export async function newAccount() {
  // Accounts has a limit of 10 apps and 100 assets. Therefore, we need to create a new account for most of the tests.
  const account = algosdk.generateAccount();
  await fundAccountWithAlgos(account, 10_000_000);
  return account;
}

export async function fundAccountWithAlgos(
  account: algosdk.Account,
  amount: number,
) {
  const suggestedParams = await algod.getTransactionParams().do();
  const tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: ROOT_ACCOUNT.addr,
    to: account.addr,
    amount: amount,
    suggestedParams,
  });
  await signAndSend(tx, ROOT_ACCOUNT);
}

export type TestBed = {
  account: algosdk.Account;
  pact: PactClient;
  algo: Asset;
  coin: Asset;
  pool: Pool;
};

export async function makeFreshTestBed(
  options: {
    poolType?: PoolType;
    feeBps?: number;
    amplifier?: number;
  } = {},
): Promise<TestBed> {
  const account = await newAccount();
  const pact = new PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const coinIndex = await createAsset(account);
  const coin = await pact.fetchAsset(coinIndex);

  const poolType = options.poolType ?? "CONSTANT_PRODUCT";
  const appId = await deployContract(
    account,
    poolType,
    algo.index,
    coin.index,
    {
      feeBps: options.feeBps,
      amplifier: options.amplifier,
    },
  );
  const pool = await pact.fetchPoolById(appId);

  return { account, pact, algo, coin, pool };
}
