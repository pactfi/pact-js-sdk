import { exec } from "child_process";

import algosdk from "algosdk";

import { Asset } from "./asset";
import { Client } from "./client";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

const ROOT_ACCOUNT_MNEMONIC =
  "jelly swear alcohol hybrid wrong camp prize attack hurdle shaft solar entry inner arm region economy awful inch they squirrel sort renew legend absorb giant";

export const ROOT_ACCOUNT = algosdk.mnemonicToSecretKey(ROOT_ACCOUNT_MNEMONIC);

export const algod = new algosdk.Algodv2(
  "8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3",
  "http://localhost",
  8787,
);

export async function signSendAndWait(
  txToSend: algosdk.Transaction | TransactionGroup,
  account: algosdk.Account,
) {
  const signedTx = txToSend.signTxn(account.sk);
  const tx = await algod.sendRawTransaction(signedTx).do();
  await algosdk.waitForConfirmation(algod, tx.txId, 2);
  return tx;
}

export async function createAsset(
  account: algosdk.Account,
  name = "COIN",
  decimals = 6,
): Promise<number> {
  const suggestedParams = await algod.getTransactionParams().do();

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParams(
    account.addr,
    undefined, // note
    1_000_000, // totalIssuance
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

  const tx = await signSendAndWait(txn, account);
  const ptx = await algod.pendingTransactionInformation(tx.txId).do();
  return ptx["asset-index"];
}

export async function deployContract(
  account: algosdk.Account,
  primaryAsset: Asset,
  secondaryAsset: Asset,
  options: {
    feeBps?: number;
  } = {},
): Promise<number> {
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  const command = `
    cd contracts_v1 && \\
    ALGOD_URL=http://localhost:8787 \\
    ALGOD_TOKEN=8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3 \\
    DEPLOYER_MNEMONIC="${mnemonic}" \\
    poetry run python scripts/deploy.py \\
   --primary_asset_id=${primaryAsset.index} \\
   --secondary_asset_id=${secondaryAsset.index} \\
   --fee_bps=${options.feeBps ?? 30}
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
  await signSendAndWait(optInTx, account);

  const addLiqTx = await pool.prepareAddLiquidityTx({
    address: account.addr,
    primaryAssetAmount,
    secondaryAssetAmount,
  });
  await signSendAndWait(addLiqTx, account);
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
  await signSendAndWait(tx, ROOT_ACCOUNT);
}

export type TestPool = {
  account: algosdk.Account;
  client: Client;
  algo: Asset;
  coin: Asset;
  pool: Pool;
};

export async function makeFreshTestPool(
  options: {
    feeBps?: number;
  } = {},
): Promise<TestPool> {
  const account = await newAccount();
  const client = new Client(algod);

  const algo = await client.fetchAsset(0);
  const coinIndex = await createAsset(account);
  const coin = await client.fetchAsset(coinIndex);

  const appId = await deployContract(account, algo, coin, {
    feeBps: options.feeBps,
  });
  const pool = await client.fetchPool(algo, coin, {
    appId,
    feeBps: options.feeBps,
  });

  return { account, client, algo, coin, pool };
}
