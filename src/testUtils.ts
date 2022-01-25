import algosdk from "algosdk";

import { Client, ClientOptions } from "./client";
import { TransactionGroup } from "./transactionGroup";

export const EXCHANGE_APP_ID = 3;
export const EXCHANGE_LIQUIDITY_ID = 6;

export const ROOT_ACCOUNT = algosdk.mnemonicToSecretKey(
  "jelly swear alcohol hybrid wrong camp prize attack hurdle shaft solar entry inner arm region economy awful inch they squirrel sort renew legend absorb giant",
);

export const USER_ACCOUNT = algosdk.mnemonicToSecretKey(
  "off cushion utility forum little square stairs situate mix cradle over work cable despair powder exile notice urban napkin method fossil junk master abandon fold",
);

export function getAlgod() {
  return new algosdk.Algodv2(
    "8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3",
    "http://localhost",
    8787,
  );
}

export function getClientParams(): ClientOptions {
  return {
    algod: getAlgod(),
  };
}

export async function signSendAndWait(
  client: Client,
  txToSend: algosdk.Transaction | TransactionGroup,
  account: algosdk.Account,
) {
  let signedTx;
  if (txToSend instanceof TransactionGroup) {
    signedTx = txToSend.signWithPrivateKey(account.sk);
  } else {
    signedTx = txToSend.signTxn(account.sk);
  }
  const tx = await client.algod.sendRawTransaction(signedTx).do();
  await algosdk.waitForConfirmation(client.algod, tx.txId, 2);
  return tx;
}

export async function createAsset(
  client: Client,
  name: string,
  decimals: number,
  account: algosdk.Account,
): Promise<number> {
  const suggestedParams = await client.algod.getTransactionParams().do();

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

  const tx = await signSendAndWait(client, txn, account);
  const ptx = await client.algod.pendingTransactionInformation(tx.txId).do();
  return ptx["asset-index"];
}
