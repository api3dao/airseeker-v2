import type { Address, Hex } from '@api3/commons';
import type { Api3ServerV1 } from '@api3/contracts';
import { go } from '@api3/promise-utils';
import { type EthersError, ethers } from 'ethers';

import { getRecommendedGasPrice } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import {
  deriveSponsorAddress,
  deriveSponsorWalletFromSponsorAddress,
  sanitizeEthersError,
  type SponsorAddressDerivationParams,
} from '../utils';

import { estimateMulticallGasLimit, estimateSingleBeaconGasLimit } from './gas-estimation';
import type { UpdatableDataFeed } from './get-updatable-feeds';

export const createUpdateFeedCalldatas = (api3ServerV1: Api3ServerV1, updatableDataFeed: UpdatableDataFeed) => {
  const { dataFeedInfo, updatableBeacons, shouldUpdateBeaconSet } = updatableDataFeed;
  const allBeacons = dataFeedInfo.beaconsWithData;

  // Create calldata for beacons that need to be updated.
  const beaconUpdateCalls = updatableBeacons.map(({ signedData }) =>
    api3ServerV1.interface.encodeFunctionData('updateBeaconWithSignedData', [
      signedData.airnode,
      signedData.templateId,
      signedData.timestamp,
      signedData.encodedValue,
      signedData.signature,
    ])
  );

  // If there are multiple beacons in the data feed it's a beacons set which we may need to update as well.
  return allBeacons.length > 1 && shouldUpdateBeaconSet
    ? [
        ...beaconUpdateCalls,
        api3ServerV1.interface.encodeFunctionData('updateBeaconSetWithBeacons', [
          allBeacons.map(({ beaconId }) => beaconId),
        ]),
      ]
    : beaconUpdateCalls;
};

export const submitUpdate = async (
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  fallbackGasLimit: number | undefined,
  sponsorWallet: ethers.HDNodeWallet | ethers.Wallet,
  gasPrice: bigint,
  nonce: number
) => {
  const goSubmitUpdate = await go(async () => {
    const sponsorWalletAddress = sponsorWallet.address as Address;

    const isSingleBeaconUpdate =
      updatableDataFeeds.length === 1 && updatableDataFeeds[0]?.dataFeedInfo.beaconsWithData.length === 1;
    if (isSingleBeaconUpdate) {
      const { updatableBeacons } = updatableDataFeeds[0]!;
      const beacon = updatableBeacons[0]!;

      logger.debug('Estimating single beacon update gas limit.');
      const gasLimit = await estimateSingleBeaconGasLimit(api3ServerV1, beacon, fallbackGasLimit);
      if (!gasLimit) return null;

      logger.info('Updating single beacon.', {
        sponsorWalletAddress,
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        nonce,
      });
      const {
        signedData: { airnode, templateId, timestamp, encodedValue, signature },
      } = beacon;
      return api3ServerV1
        .connect(sponsorWallet)
        .updateBeaconWithSignedData.send(airnode, templateId, timestamp, encodedValue, signature, {
          gasPrice,
          gasLimit,
          nonce,
        });
    }

    logger.debug('Creating calldatas.');
    const dataFeedUpdateCalldatas = updatableDataFeeds.flatMap((updatableDataFeed) =>
      createUpdateFeedCalldatas(api3ServerV1, updatableDataFeed)
    );

    logger.debug('Estimating multicall update gas limit.');
    const gasLimit = await estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas, fallbackGasLimit);
    if (!gasLimit) return null;

    logger.info('Updating data feed(s).', {
      sponsorWalletAddress,
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      nonce,
    });
    return api3ServerV1
      .connect(sponsorWallet)
      .tryMulticall.send(dataFeedUpdateCalldatas, { gasPrice, gasLimit, nonce });
  });
  if (!goSubmitUpdate.success) {
    // It seems that in practice, this code is widely used. We can do a best-effort attempt to determine the error
    // reason. Many times, the error is acceptable and results from the way Airseeker is designed. We can use
    // different log levels and messages and have better alerts.
    const ethersError = goSubmitUpdate.error as EthersError;
    if (ethersError.code === 'REPLACEMENT_UNDERPRICED') {
      logger.info(`Failed to submit replacement transaction because it was underpriced.`);
      return null;
    } else if (ethersError.code === 'NONCE_EXPIRED' || ethersError.message.includes('invalid nonce')) {
      logger.info(`Failed to submit the transaction because the nonce was expired.`);
      return null;
    } else if (ethersError.code === 'INSUFFICIENT_FUNDS') {
      // This should never happen and monitoring should warn even before Airseeker comes to this point.
      logger.error(`Failed to submit the transaction because of insufficient funds.`, sanitizeEthersError(ethersError));
      return null;
    } else {
      logger.warn(`Failed to submit the update transaction.`, sanitizeEthersError(ethersError));
      return null;
    }
  }

  if (!goSubmitUpdate.data) return null; // There was a handled error during submission.
  logger.info('Successfully submitted the update transaction.', { txHash: goSubmitUpdate.data.hash });
  return goSubmitUpdate.data;
};

export const submitBatchTransaction = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  blockNumber: number
) => {
  const {
    config: { chains, sponsorWalletMnemonic, walletDerivationScheme },
  } = getState();

  const decodedDapiNames = updatableDataFeeds.map(({ dataFeedInfo: { decodedDapiName } }) => decodedDapiName);
  const dataFeedIds = updatableDataFeeds.map(({ dataFeedInfo: { dataFeedId } }) => dataFeedId);
  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiNames: decodedDapiNames, dataFeedIds, blockNumber }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet(sponsorWalletMnemonic, {
          ...walletDerivationScheme,
          dapiNameOrDataFeedId: '', // Not needed because using fixed sponsor wallet derivation type
          updateParameters: '', // Not needed because using fixed sponsor wallet derivation type
        }).connect(provider);
        const sponsorWalletAddress = sponsorWallet.address as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWalletAddress, blockNumber));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, goNonce.error);
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, dataFeedIds);
        if (!gasPrice) return null;

        return submitUpdate(api3ServerV1, updatableDataFeeds, fallbackGasLimit, sponsorWallet, gasPrice, nonce);
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating data feeds.`, goUpdate.error);
      return null;
    }
    return goUpdate.data;
  });
};

export const submitTransaction = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeed: UpdatableDataFeed,
  blockNumber: number
) => {
  const {
    config: { chains, sponsorWalletMnemonic, walletDerivationScheme },
  } = getState();

  const {
    dataFeedInfo: { dapiName, dataFeedId, decodedDapiName, updateParameters },
  } = updatableDataFeed;
  const { dataFeedUpdateInterval, fallbackGasLimit } = chains[chainId]!;
  const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

  return logger.runWithContext({ dapiName: decodedDapiName, dataFeedId, blockNumber }, async () => {
    // NOTE: We use go mainly to set a timeout for the whole update process. We expect the function not to throw and
    // handle errors internally.
    const goUpdate = await go(
      async () => {
        logger.debug('Getting derived sponsor wallet.');
        const sponsorWallet = getDerivedSponsorWallet(sponsorWalletMnemonic, {
          ...walletDerivationScheme,
          dapiNameOrDataFeedId: dapiName ?? dataFeedId,
          updateParameters,
        }).connect(provider);
        const sponsorWalletAddress = sponsorWallet.address as Address;

        logger.debug('Getting nonce.');
        const goNonce = await go(async () => provider.getTransactionCount(sponsorWalletAddress, blockNumber));
        if (!goNonce.success) {
          logger.warn(`Failed to get nonce.`, sanitizeEthersError(goNonce.error));
          return null;
        }
        const nonce = goNonce.data;

        logger.debug('Getting recommended gas price.');
        const gasPrice = getRecommendedGasPrice(chainId, providerName, sponsorWalletAddress, [dataFeedId]);
        if (!gasPrice) return null;

        return submitUpdate(api3ServerV1, [updatableDataFeed], fallbackGasLimit, sponsorWallet, gasPrice, nonce);
      },
      { totalTimeoutMs: dataFeedUpdateIntervalMs }
    );

    if (!goUpdate.success) {
      logger.error(`Unexpected error during updating data feed.`, sanitizeEthersError(goUpdate.error));
      return null;
    }
    return goUpdate.data;
  });
};

export const submitTransactions = async (
  chainId: string,
  providerName: string,
  provider: ethers.JsonRpcProvider,
  api3ServerV1: Api3ServerV1,
  updatableDataFeeds: UpdatableDataFeed[],
  blockNumber: number
) => {
  if (updatableDataFeeds.length === 0) {
    return 0;
  }

  const {
    config: { walletDerivationScheme },
  } = getState();
  if (walletDerivationScheme.type === 'fixed') {
    const result = await submitBatchTransaction(
      chainId,
      providerName,
      provider,
      api3ServerV1,
      updatableDataFeeds,
      blockNumber
    );
    return result ? updatableDataFeeds.length : 0;
  }

  const result = await Promise.all(
    updatableDataFeeds.map(async (dataFeed) =>
      submitTransaction(chainId, providerName, provider, api3ServerV1, dataFeed, blockNumber)
    )
  );
  return result.filter(Boolean).length;
};

export const getDerivedSponsorWallet = (sponsorWalletMnemonic: string, params: SponsorAddressDerivationParams) => {
  const { derivedSponsorWallets } = getState();
  const sponsorAddress = deriveSponsorAddress(params);
  const privateKey = derivedSponsorWallets?.[sponsorAddress];
  if (privateKey) {
    const sponsorWallet = new ethers.Wallet(privateKey);
    logger.debug('Found derived sponsor wallet.', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });
    return sponsorWallet;
  }
  const sponsorWallet = deriveSponsorWalletFromSponsorAddress(sponsorWalletMnemonic, sponsorAddress);
  logger.debug('Derived new sponsor wallet.', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });
  updateState((draft) => {
    draft.derivedSponsorWallets[sponsorAddress] = sponsorWallet.privateKey as Hex;
  });
  return sponsorWallet;
};
