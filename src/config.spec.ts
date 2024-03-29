import { PactClient } from "./client";
import { getGasStation } from "./gasStation";
import { algod } from "./testUtils";

describe("config", () => {
  it("change client config", () => {
    let pact = new PactClient(algod);
    expect(pact.config).toEqual({
      apiUrl: "https://api.pact.fi",
      gasStationId: 1027956681,
      factoryConstantProductId: 1072843805,
      factoryNftConstantProductId: 1076423760,
      folksLendingPoolAdapterId: 1123472996,
    });
    expect(getGasStation().appId).toBe(1027956681);

    pact = new PactClient(algod, { network: "mainnet" });
    expect(pact.config).toEqual({
      apiUrl: "https://api.pact.fi",
      gasStationId: 1027956681,
      factoryConstantProductId: 1072843805,
      factoryNftConstantProductId: 1076423760,
      folksLendingPoolAdapterId: 1123472996,
    });

    pact = new PactClient(algod, { network: "testnet" });
    expect(pact.config).toEqual({
      apiUrl: "https://api.testnet.pact.fi",
      gasStationId: 156575978,
      factoryConstantProductId: 166540424,
      factoryNftConstantProductId: 190269485,
      folksLendingPoolAdapterId: 228284187,
    });

    pact = new PactClient(algod, { network: "dev" });
    expect(pact.config).toEqual({
      apiUrl: "",
      gasStationId: 0,
      factoryConstantProductId: 0,
      factoryNftConstantProductId: 0,
      folksLendingPoolAdapterId: 0,
    });

    pact = new PactClient(algod, { apiUrl: "overwritten_url" });
    expect(pact.config).toEqual({
      apiUrl: "overwritten_url",
      gasStationId: 1027956681,
      factoryConstantProductId: 1072843805,
      factoryNftConstantProductId: 1076423760,
      folksLendingPoolAdapterId: 1123472996,
    });

    pact = new PactClient(algod, {
      network: "dev",
      factoryConstantProductId: 123,
    });
    expect(pact.config).toEqual({
      apiUrl: "",
      gasStationId: 0,
      factoryConstantProductId: 123,
      factoryNftConstantProductId: 0,
      folksLendingPoolAdapterId: 0,
    });
  });
});
