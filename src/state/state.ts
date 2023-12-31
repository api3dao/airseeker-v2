import type { BigNumber } from 'ethers';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type {
  PrivateKey,
  ChainId,
  SignedData,
  BeaconId,
  ProviderName,
  SignedApiUrl,
  AirnodeAddress,
  DapiNameOrDataFeedId,
} from '../types';

interface GasState {
  gasPrices: { price: BigNumber; timestamp: number }[];
  sponsorLastUpdateTimestamp: Record<string, number>;
}

export interface State {
  config: Config;
  gasPrices: Record<ChainId, Record<ProviderName, GasState>>;
  derivedSponsorWallets: Record<DapiNameOrDataFeedId, PrivateKey>;
  signedDatas: Record<BeaconId, SignedData>;
  signedApiUrls: Record<ChainId, Record<ProviderName, Record<AirnodeAddress, SignedApiUrl>>>;
}

let state: State | undefined;

export const getState = (): State => {
  if (!state) {
    throw new Error('State is undefined.');
  }

  return state;
};

export const setInitialState = (config: Config) => {
  state = {
    config,
    gasPrices: {},
    signedDatas: {},
    signedApiUrls: {},
    derivedSponsorWallets: {},
  };
};

export const updateState = (updater: (draft: Draft<State>) => void) => {
  state = produce(getState(), updater);
};
