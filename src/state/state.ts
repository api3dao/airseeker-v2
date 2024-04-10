import type { Address } from '@api3/commons';
import { produce, type Draft } from 'immer';

import type { Config } from '../config/schema';
import type {
  PrivateKey,
  ChainId,
  SignedData,
  BeaconId,
  ProviderName,
  SignedApiUrl,
  DapiNameOrDataFeedId,
} from '../types';

interface GasPriceInfo {
  price: bigint;
  timestamp: number;
}

export interface State {
  config: Config;
  gasPrices: Record<ChainId, Record<ProviderName, GasPriceInfo[]>>;
  // The timestamp of when we last detected that the feed requires an update. Note, that if the feed requires an update
  // consecutively, the timestamp is not updated until the feed stops being updatable again.
  firstMarkedUpdatableTimestamps: Record<
    ChainId,
    Record<ProviderName, Record<Address /* Sponsor wallet */, number | null>>
  >;
  derivedSponsorWallets: Record<DapiNameOrDataFeedId, PrivateKey>;
  signedDatas: Record<BeaconId, SignedData>;
  signedApiUrls: Record<ChainId, Record<ProviderName, SignedApiUrl[]>>;
  // The timestamp of when the service was initialized. This can be treated as a "deployment" timestamp.
  deploymentTimestamp: string;
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
    firstMarkedUpdatableTimestamps: {},
    signedDatas: {},
    signedApiUrls: {},
    derivedSponsorWallets: {},
    deploymentTimestamp: Math.floor(Date.now() / 1000).toString(),
  };
};

export const updateState = (updater: (draft: Draft<State>) => void) => {
  state = produce(getState(), updater);
};
