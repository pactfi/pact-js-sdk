import { exec } from "child_process";

import algosdk from "algosdk";

import { encode } from "./encoding";
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

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: account.addr,
    total: BigInt(totalIssuance),
    decimals,
    manager: account.addr,
    reserve: account.addr,
    clawback: account.addr,
    freeze: account.addr,
    assetName: name,
    unitName: name,
    defaultFrozen: false,
    suggestedParams,
  });

  const tx = await signAndSend(txn, account);
  const ptx = await algod.pendingTransactionInformation(tx.txId).do();
  return ptx["asset-index"];
}

export function deployContract(
  account: algosdk.Account,
  command: string[],
): Promise<number> {
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

  command = [
    "cd algorand-testbed &&",
    "ALGOD_URL=http://localhost:8787",
    "ALGOD_TOKEN=8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3",
    `DEPLOYER_MNEMONIC="${mnemonic}"`,
    "poetry",
    "run",
    "python",
    "scripts/deploy.py",
    ...command,
  ];

  return new Promise((resolve, reject) => {
    exec(command.join(" "), (error, stdout, stderr) => {
      if (error) {
        reject(error.message);
        return;
      }
      if (stderr) {
        reject(stderr);
        return;
      }
      const idRegex = /APP ID: (\d+)/;
      const match = idRegex.exec(stdout);
      if (!match) {
        reject("Can't find app id in std out.");
        return;
      }

      resolve(parseInt(match[1]));
    });
  });
}

export async function newAccount() {
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

export async function deployGasStation() {
  const gasStationId = await deployContract(ROOT_ACCOUNT, ["gas-station"]);
  const suggestedParams = await algod.getTransactionParams().do();
  const tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: ROOT_ACCOUNT.addr,
    to: algosdk.getApplicationAddress(gasStationId),
    amount: 100_000,
    suggestedParams,
  });
  await signAndSend(tx, ROOT_ACCOUNT);

  return gasStationId;
}

export async function waitRounds(rounds: number, account: algosdk.Account) {
  const suggestedParams = await algod.getTransactionParams().do();
  for (let i = 0; i < rounds; i++) {
    const tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: account.addr,
      to: account.addr,
      amount: 0,
      suggestedParams,
      note: encode(i.toString()),
    });
    await signAndSend(tx, account);
  }
}

export async function getLastBlock() {
  const statusData = await algod.status().do();
  return statusData["last-round"];
}
