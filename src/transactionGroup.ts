import algosdk, { Transaction } from "algosdk";

export class TransactionGroup {
  transactions: algosdk.Transaction[];
  groupIdBuffer: Buffer;

  constructor(transactions: Transaction[]) {
    if (transactions.length === 0) {
      throw Error("Cannot create TransactionGroup: empty transactions list.");
    }
    this.transactions = algosdk.assignGroupID(transactions);

    const firstTx = this.transactions[0];
    if (!firstTx.group) {
      throw Error("Cannot retrieve group id from transaction.");
    }
    this.groupIdBuffer = firstTx.group;
  }

  signTxn(secretKey: Uint8Array): Uint8Array[] {
    return this.transactions.map((tx) => tx.signTxn(secretKey));
  }

  get groupId() {
    return Buffer.from(this.groupIdBuffer).toString("base64");
  }
}
