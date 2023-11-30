import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { isError, range, size, zip } from 'lodash';

import type { Chain } from '../config/schema';
import { RPC_PROVIDER_TIMEOUT_MS } from '../constants';
import { clearSponsorLastUpdateTimestampMs, initializeGasState } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import type { ChainId, ProviderName } from '../types';
import { sleep, deriveSponsorWallet } from '../utils';

import {
  decodeDapisCountResponse,
  decodeReadDapiWithIndexResponse,
  getDapiDataRegistry,
  verifyMulticallResponse,
  type DecodedReadDapiWithIndexResponse,
  getApi3ServerV1,
} from './contracts';
import { getUpdatableFeeds } from './get-updatable-feeds';
import { hasSponsorPendingTransaction, submitTransactions } from './submit-transactions';

export const startUpdateFeedsLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
      const { dataFeedUpdateInterval, providers } = chain;
      const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

      // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
      // frequency.
      const staggerTime = dataFeedUpdateIntervalMs / size(providers);
      logger.debug(`Starting update loops for chain`, { chainId, staggerTime, providerNames: Object.keys(providers) });

      for (const providerName of Object.keys(providers)) {
        logger.debug(`Initializing gas state`, { chainId, providerName });
        initializeGasState(chainId, providerName);

        logger.debug(`Starting update feed loop`, { chainId, providerName });
        // Run the update feed loop manually for the first time, because setInterval first waits for the given period of
        // time before calling the callback function.
        void runUpdateFeeds(providerName, chain, chainId);
        setInterval(async () => runUpdateFeeds(providerName, chain, chainId), dataFeedUpdateIntervalMs);

        await sleep(staggerTime);
      }
    })
  );
};

export const calculateStaggerTime = (
  batchesCount: number,
  firstBatchDuration: number,
  dataFeedUpdateIntervalMs: number
) => {
  // First batch duration should not be longer than the update interval because we have a timeout in place. However, it
  // may happen if the fetching resolves very close to the end of timeout and the duration ends up slightly larger. It's
  // arguably a bit better to let the function return 0 instead of throwing an error.
  if (batchesCount <= 1 || firstBatchDuration >= dataFeedUpdateIntervalMs) return 0;

  // Calculate the optimal stagger time between the the batches.
  const optimalStaggerTime = Math.round(dataFeedUpdateIntervalMs / batchesCount);
  // If the first batch took longer than the optimal stagger time, we use the remaining time to stagger the rest of
  // the batches.
  if (firstBatchDuration > optimalStaggerTime) {
    return batchesCount === 2 ? 0 : Math.round((dataFeedUpdateIntervalMs - firstBatchDuration) / (batchesCount - 1));
  }
  return optimalStaggerTime;
};

export const runUpdateFeeds = async (providerName: ProviderName, chain: Chain, chainId: ChainId) => {
  await logger.runWithContext({ chainId, providerName, updateFeedsCoordinatorId: Date.now().toString() }, async () => {
    // We do not expect this function to throw, but its possible that some execution path is incorrectly handled and we
    // want to process the error ourselves, for example log the error using the configured format.
    const goRunUpdateFeeds = await go(async () => {
      const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;
      const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

      // Create a provider and connect it to the DapiDataRegistry contract.
      const provider = new ethers.providers.StaticJsonRpcProvider({
        url: providers[providerName]!.url,
        timeout: RPC_PROVIDER_TIMEOUT_MS,
      });
      const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

      logger.debug(`Fetching first batch of dAPIs batches`);
      const firstBatchStartTime = Date.now();
      const goFirstBatch = await go(
        async () => {
          const dapisCountCalldata = dapiDataRegistry.interface.encodeFunctionData('dapisCount');
          const readDapiWithIndexCalldatas = range(0, dataFeedBatchSize).map((dapiIndex) =>
            dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [dapiIndex])
          );
          const [dapisCountReturndata, ...readDapiWithIndexCallsReturndata] = verifyMulticallResponse(
            await dapiDataRegistry.callStatic.tryMulticall([dapisCountCalldata, ...readDapiWithIndexCalldatas])
          );

          const dapisCount = decodeDapisCountResponse(dapiDataRegistry, dapisCountReturndata!);
          const firstBatch = readDapiWithIndexCallsReturndata
            // Because the dapisCount is not known during the multicall, we may ask for non-existent dAPIs. These should be filtered out.
            .slice(0, dapisCount)
            .map((dapiReturndata) => ({
              ...decodeReadDapiWithIndexResponse(dapiDataRegistry, dapiReturndata),
              chainId,
            }));
          return {
            firstBatch,
            dapisCount,
          };
        },
        { totalTimeoutMs: dataFeedUpdateIntervalMs }
      );
      if (!goFirstBatch.success) {
        logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error);
        return;
      }

      const { firstBatch, dapisCount } = goFirstBatch.data;
      if (dapisCount === 0) {
        logger.warn(`No active dAPIs found`);
        return;
      }
      // NOTE: We need to explicitly handle the .catch here because it's possible that the promise settles before it's
      // awaited, causing unhandled promise rejection. We do not expect this function to throw, but we want the promise
      // chain to be handled correctly in case there is some unhandled error.
      const processFirstBatchPromise: Promise<Error> | ReturnType<typeof processBatch> = processBatch(
        firstBatch,
        providerName,
        provider,
        chainId
      ).catch((error) => error);

      // Calculate the stagger time.
      const batchesCount = Math.ceil(dapisCount / dataFeedBatchSize);
      const firstBatchDuration = Date.now() - firstBatchStartTime;
      const staggerTime = calculateStaggerTime(batchesCount, firstBatchDuration, dataFeedUpdateIntervalMs);

      // Wait the remaining stagger time required after fetching the first batch.
      await sleep(Math.max(0, staggerTime - firstBatchDuration));

      // Fetch the rest of the batches in parallel in a staggered way and process them.
      if (batchesCount > 1) {
        logger.debug('Fetching batches of active dAPIs', { batchesCount, staggerTime });
      }
      const processOtherBatchesPromises = range(1, batchesCount).map(async (batchIndex) => {
        await sleep((batchIndex - 1) * staggerTime);

        const goBatch = await go(async () => {
          logger.debug(`Fetching batch of active dAPIs`, { batchIndex });
          const dapiBatchIndexStart = batchIndex * dataFeedBatchSize;
          const dapiBatchIndexEnd = Math.min(dapisCount, dapiBatchIndexStart + dataFeedBatchSize);
          const readDapiWithIndexCalldatas = range(dapiBatchIndexStart, dapiBatchIndexEnd).map((dapiIndex) =>
            dapiDataRegistry.interface.encodeFunctionData('readDapiWithIndex', [dapiIndex])
          );
          const returndata = verifyMulticallResponse(
            await dapiDataRegistry.callStatic.tryMulticall(readDapiWithIndexCalldatas)
          );

          return returndata.map((returndata) => decodeReadDapiWithIndexResponse(dapiDataRegistry, returndata));
        });
        if (!goBatch.success) {
          logger.error(`Failed to get active dAPIs batch`, goBatch.error);
          return;
        }
        const batch = goBatch.data;

        return processBatch(batch, providerName, provider, chainId);
      });

      // Wait for all the batches to be processed and print stats from this run.
      const processedBatches = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        new Promise<Awaited<ReturnType<typeof processBatch>>>((resolve, reject) => {
          return processFirstBatchPromise.then((result) => {
            // eslint-disable-next-line promise/always-return
            if (isError(result)) reject(result);
            else resolve(result);
          });
        }),
        ...processOtherBatchesPromises,
      ]);

      // Print stats from this run.
      const skippedBatchesCount = processedBatches.filter((batch) => !batch).length;
      const dapiUpdates = processedBatches.reduce((acc, batch) => acc + (batch ? batch.successCount : 0), 0);
      const dapiUpdateFailures = processedBatches.reduce((acc, batch) => acc + (batch ? batch.errorCount : 0), 0);
      logger.debug(`Finished processing batches of active dAPIs`, {
        skippedBatchesCount,
        dapiUpdates,
        dapiUpdateFailures,
      });
    });

    if (!goRunUpdateFeeds.success) {
      logger.error(`Unexpected error when updating data feeds feeds`, goRunUpdateFeeds.error);
    }
  });
};

export const processBatch = async (
  batch: DecodedReadDapiWithIndexResponse[],
  providerName: ProviderName,
  provider: ethers.providers.StaticJsonRpcProvider,
  chainId: ChainId
) => {
  logger.debug('Processing batch of active dAPIs', { dapiNames: batch.map((dapi) => dapi.decodedDapiName) });
  const {
    config: { sponsorWalletMnemonic, chains, deviationThresholdCoefficient },
  } = getState();
  const { contracts } = chains[chainId]!;

  updateState((draft) => {
    for (const dapi of batch) {
      const receivedUrls = zip(dapi.signedApiUrls, dapi.decodedDataFeed.beacons).map(([url, beacon]) => ({
        url: `${url}/${beacon!.airnodeAddress}`,
        airnodeAddress: beacon!.airnodeAddress,
      }));
      if (!draft.signedApiUrls) draft.signedApiUrls = {};
      if (!draft.signedApiUrls[chainId]) draft.signedApiUrls[chainId] = {};
      if (!draft.signedApiUrls[chainId]![providerName]) draft.signedApiUrls[chainId]![providerName] = {};
      for (const { airnodeAddress, url } of receivedUrls) {
        draft.signedApiUrls[chainId]![providerName]![airnodeAddress] = url;
      }
    }
  });

  const feedsToUpdate = await getUpdatableFeeds(batch, deviationThresholdCoefficient, provider, chainId);
  const dapiNamesToUpdate = new Set(feedsToUpdate.map((feed) => feed.dapiInfo.dapiName));

  // Clear last update timestamps for feeds that don't need an update
  for (const feed of batch) {
    const { dapiName, decodedDapiName } = feed;

    if (!dapiNamesToUpdate.has(dapiName)) {
      const sponsorWalletAddress = deriveSponsorWallet(sponsorWalletMnemonic, dapiName).address;
      const timestampNeedsClearing = hasSponsorPendingTransaction(chainId, providerName, sponsorWalletAddress);
      if (timestampNeedsClearing) {
        // NOTE: A dAPI may stop needing an update for two reasons:
        //  1. It has been updated by a transaction. This could have been done by this Airseeker or some backup.
        //  2. As a natural price shift in signed API data.
        //
        // We can't differentiate between these cases unless we check recent update transactions, which we don't want to
        // do.
        logger.debug(`Clearing dAPI update timestamp because it no longer needs an update`, {
          dapiName: decodedDapiName,
        });
        clearSponsorLastUpdateTimestampMs(chainId, providerName, sponsorWalletAddress);
      }
    }
  }

  const updatedFeeds = await submitTransactions(
    chainId,
    providerName,
    provider,
    getApi3ServerV1(contracts.Api3ServerV1, provider),
    feedsToUpdate
  );
  const successCount = updatedFeeds.filter(Boolean).length;
  return { successCount, errorCount: size(feedsToUpdate) - successCount };
};