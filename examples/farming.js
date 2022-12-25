/**
 * This example fetches a farm and performs various user actions on it.
 * TODO validate that it works
 */

import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod);

  const farm = await pact.farming.fetchFarmById(123)
  const escrow = await farm.fetchEscrowByAddress(address)

  if (!escrow){
      // Deploy escrow.
      await farm.refreshSuggestedParams()

      const deployTxs = farm.buildDeployEscrowTxs(address);
      const signedDeployTxs = pactsdk.TransactionGroup(deployTxs).signTxn(account.sk);
      await algod.sendRawTransaction(signedDeployTxs).do();

      const txinfo = await algod.pendingTransactionInformation(deployTxs[1].txID()).do();
      const escrowId = txinfo["application-index"]

      const escrow = await farm.fetchEscrowById(escrowId)
      await escrow.refreshSuggestedParams()
  }

  // Inspect farm state.
  console.log(farm.state);

  // Need to be called before first transaction.
  await farm.refreshSuggestedParams()


  async function updateFarm() {
    const updateTxs = farm.buildUpdateWithOpcodeIncreaseTxs(escrow)
    const group = new pactsdk.TransactionGroup(updateTxs)
    const signedTx = group.sign(account.sk)
    await algod.sendRawTransaction(signedTx).do()

    // Update farm state.
    await farm.updateState()
  }


  await updateFarm()

  // Stake tokens.
  const stakeTxs = escrow.buildStakeTxs(100_000)
  let group = new pactsdk.TransactionGroup(stakeTxs)
  let signedGroup = group.sign(account.sk)
  await algod.sendRawTransaction(signedGroup).do()
  console.log(`Stake transaction group ${group.groupId}`)

  // Inspect user state.
  const userState = await escrow.fetchUserState()
  console.log(userState)

  // Unstake.
  const unstakeTxs = escrow.buildUnstakeTxs(100_000)
  group = new pactsdk.TransactionGroup(unstakeTxs)
  signedTx = group.sign(account.sk)
  await algod.sendRawTransaction(signedTx).do()
  console.log(`Unstake transaction group ${group.groupId}`)

  // Claim
  claimTx = escrow.buildClaimRewardsTx()
  signedTx = claimTx.sign(account.sk)
  await algod.sendRawTransaction(signedTx).do()
  console.log(`Claim transaction ${claimTx.txID()}`)
})();