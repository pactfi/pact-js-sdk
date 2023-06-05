const MAINNET_API_URL = "https://api.pact.fi";
const MAINNET_GAS_STATION_ID = 1027956681;
const MAINNET_FOLKS_LENDING_POOL_ADAPTER_ID = 0;
const MAINNET_FACTORY_CONSTANT_PRODUCT_ID = 1072843805;
const MAINNET_FACTORY_NFT_CONSTANT_PRODUCT_ID = 1076423760;

const TESTNET_API_URL = "https://api.testnet.pact.fi";
const TESTNET_GAS_STATION_ID = 156575978;
const TESTNET_FOLKS_LENDING_POOL_ADAPTER_ID = 227360452;
const TESTNET_FACTORY_CONSTANT_PRODUCT_ID = 166540424;
const TESTNET_FACTORY_NFT_CONSTANT_PRODUCT_ID = 190269485;

export type Network = "mainnet" | "testnet" | "dev";

export type Config = {
  apiUrl: string;
  gasStationId: number;
  folksLendingPoolAdapterId: number;
  factoryConstantProductId: number;
  factoryNftConstantProductId: number;
};

export function getConfig(
  network: Network,
  overwrite: Partial<Config> = {},
): Config {
  if (network === "mainnet") {
    return {
      apiUrl: MAINNET_API_URL,
      gasStationId: MAINNET_GAS_STATION_ID,
      folksLendingPoolAdapterId: MAINNET_FOLKS_LENDING_POOL_ADAPTER_ID,
      factoryConstantProductId: MAINNET_FACTORY_CONSTANT_PRODUCT_ID,
      factoryNftConstantProductId: MAINNET_FACTORY_NFT_CONSTANT_PRODUCT_ID,
      ...overwrite,
    };
  } else if (network === "testnet") {
    return {
      apiUrl: TESTNET_API_URL,
      gasStationId: TESTNET_GAS_STATION_ID,
      folksLendingPoolAdapterId: TESTNET_FOLKS_LENDING_POOL_ADAPTER_ID,
      factoryConstantProductId: TESTNET_FACTORY_CONSTANT_PRODUCT_ID,
      factoryNftConstantProductId: TESTNET_FACTORY_NFT_CONSTANT_PRODUCT_ID,
      ...overwrite,
    };
  } else if (network === "dev") {
    return {
      apiUrl: "",
      gasStationId: 0,
      folksLendingPoolAdapterId: 0,
      factoryConstantProductId: 0,
      factoryNftConstantProductId: 0,
      ...overwrite,
    };
  }

  throw new Error(`"No predefined config for network ${network}`);
}
