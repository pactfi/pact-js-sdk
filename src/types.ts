import { Asset } from "./asset";

export type AssetPair = {
  appId: number;
  primaryAsset: Asset;
  secondaryAsset: Asset;
};

export type OperationType = "SWAP" | "ADDLIQ" | "REMLIQ";
