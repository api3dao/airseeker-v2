import type { Address, ChainId, Hex } from '@api3/commons';

import { logger } from '../logger';
import { getState, updateState, type PendingTransactionInfo } from '../state';

import type { DecodedActiveDataFeedResponse } from './contracts';
import type { UpdatableDataFeed } from './get-updatable-feeds';
import { getDerivedSponsorWallet } from './submit-transactions';

export const initializePendingTransactionsInfo = (chainId: string, providerName: string) =>
  updateState((draft) => {
    if (!draft.pendingTransactionsInfo[chainId]) draft.pendingTransactionsInfo[chainId] = {};
    draft.pendingTransactionsInfo[chainId]![providerName] = {};
  });

export const setPendingTransactionInfo = (
  chainId: string,
  providerName: string,
  sponsorWalletAddress: Address,
  dataFeedId: Hex,
  pendingTransactionInfo: PendingTransactionInfo | null
) => {
  updateState((draft) => {
    if (!draft.pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]) {
      draft.pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress] = {};
    }
    draft.pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]![dataFeedId] = pendingTransactionInfo;
  });
};

export const updatePendingTransactionsInfo = (
  chainId: ChainId,
  providerName: string,
  batch: DecodedActiveDataFeedResponse[],
  feedsToUpdate: UpdatableDataFeed[]
) => {
  const {
    config: { sponsorWalletMnemonic, walletDerivationScheme },
    pendingTransactionsInfo: pendingTransactionsInfo,
  } = getState();

  const currentTimestamp = Math.floor(Date.now() / 1000);
  for (const { beaconsWithData, dapiName, dataFeedId, decodedDapiName, updateParameters, dataFeedTimestamp } of batch) {
    const updatableFeed = feedsToUpdate.find(
      (updatableFeed) =>
        updatableFeed.dataFeedInfo.dapiName === dapiName && updatableFeed.dataFeedInfo.dataFeedId === dataFeedId
    );

    if (updatableFeed && !updatableFeed.shouldUpdateBeaconSet && beaconsWithData.length > 1) {
      // Feed is a beacon set and it will only update its beacons. Therefore no need to set nor clear pending transaction info.
      logger.warn(
        'Data feed is a beacon set that does not require an update but some of its beacons do. Skipping pending transaction info update.',
        { dapiName: decodedDapiName, dataFeedId }
      );
      continue;
    }

    const sponsorWalletAddress = getDerivedSponsorWallet(sponsorWalletMnemonic, {
      ...walletDerivationScheme,
      dapiNameOrDataFeedId: dapiName ?? dataFeedId,
      updateParameters,
    }).address as Address;

    const pendingTransactionInfo = pendingTransactionsInfo[chainId]![providerName]![sponsorWalletAddress]?.[dataFeedId];
    if (updatableFeed) {
      const isOriginalUpdate = !pendingTransactionInfo || dataFeedTimestamp !== pendingTransactionInfo.onChainTimestamp;
      const newPendingTransactionInfo: PendingTransactionInfo = isOriginalUpdate
        ? {
            consecutivelyUpdatableCount: 1,
            firstUpdatableTimestamp: currentTimestamp,
            onChainTimestamp: dataFeedTimestamp,
          }
        : {
            ...pendingTransactionInfo,
            consecutivelyUpdatableCount: pendingTransactionInfo.consecutivelyUpdatableCount + 1,
          };
      logger.info('Updating pending transaction info.', {
        ...newPendingTransactionInfo,
        dapiName: decodedDapiName,
        dataFeedId,
        sponsorWalletAddress,
      });
      setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, dataFeedId, newPendingTransactionInfo);
    }
    if (!updatableFeed && pendingTransactionInfo) {
      // NOTE: A data feed may stop needing an update for two reasons:
      //  1. It has been updated by some other transaction. This could have been done by this Airseeker or some backup.
      //  2. As a natural price shift in signed API data.
      //
      // We can't differentiate between these cases unless we check recent update transactions, which we don't want to
      // do.
      logger.info(`Clearing pending transaction info because it no longer needs an update.`, {
        dapiName: decodedDapiName,
        dataFeedId,
        totalPendingPeriod: currentTimestamp - pendingTransactionInfo.firstUpdatableTimestamp,
      });
      setPendingTransactionInfo(chainId, providerName, sponsorWalletAddress, dataFeedId, null);
    }
  }
};
