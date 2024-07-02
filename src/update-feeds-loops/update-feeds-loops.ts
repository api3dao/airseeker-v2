import type { AirseekerRegistry } from '@api3/contracts';
import { go } from '@api3/promise-utils';
import type { ethers } from 'ethers';
import { isError, range, set, size, uniq } from 'lodash';

import type { Chain } from '../config/schema';
import { fetchAndStoreGasPrice, initializeGasState } from '../gas-price';
import { logger } from '../logger';
import { getState, updateState } from '../state';
import { generateRandomId, sanitizeEthersError, sleep } from '../utils';

import {
  createProvider,
  decodeActiveDataFeedCountResponse,
  decodeActiveDataFeedResponse,
  decodeGetChainIdResponse,
  getAirseekerRegistry,
  getApi3ServerV1,
  verifyMulticallResponse,
  type DecodedActiveDataFeedResponse,
} from './contracts';
import { getUpdatableFeeds } from './get-updatable-feeds';
import { initializePendingTransactionsInfo, updatePendingTransactionsInfo } from './pending-transaction-info';
import { submitTransactions } from './submit-transactions';

export const startUpdateFeedsLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
      const { dataFeedUpdateInterval, providers, alias } = chain;
      const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

      // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
      // frequency.
      const staggerTimeMs = dataFeedUpdateIntervalMs / size(providers);
      logger.debug(`Starting update loops for chain.`, {
        chainName: alias,
        staggerTimeMs,
        providerNames: Object.keys(providers),
      });

      for (const providerName of Object.keys(providers)) {
        initializeGasState(chainId, providerName);
        initializePendingTransactionsInfo(chainId, providerName);
        logger.debug(`Starting update feeds loop.`, { chainName: alias, providerName });
        // Run the update feed loop manually for the first time, because setInterval first waits for the given period of
        // time before calling the callback function.
        void runUpdateFeeds(providerName, chain, chainId);
        setInterval(async () => runUpdateFeeds(providerName, chain, chainId), dataFeedUpdateIntervalMs);

        await sleep(staggerTimeMs);
      }
    })
  );
};

export const calculateStaggerTimeMs = (
  batchesCount: number,
  firstBatchDurationMs: number,
  dataFeedUpdateIntervalMs: number
) => {
  // First batch duration should not be longer than the update interval because we have a timeout in place. However, it
  // may happen if the fetching resolves very close to the end of timeout and the duration ends up slightly larger. It's
  // arguably a bit better to let the function return 0 instead of throwing an error.
  if (batchesCount <= 1 || firstBatchDurationMs >= dataFeedUpdateIntervalMs) return 0;

  // Calculate the optimal stagger time between the the batches.
  const optimalStaggerTimeMs = Math.round(dataFeedUpdateIntervalMs / batchesCount);
  // If the first batch took longer than the optimal stagger time, we use the remaining time to stagger the rest of
  // the batches.
  if (firstBatchDurationMs > optimalStaggerTimeMs) {
    return batchesCount === 2 ? 0 : Math.round((dataFeedUpdateIntervalMs - firstBatchDurationMs) / (batchesCount - 1));
  }
  return optimalStaggerTimeMs;
};

export const readActiveDataFeedBatch = async (
  provider: ethers.JsonRpcProvider,
  airseekerRegistry: AirseekerRegistry,
  chainId: string,
  fromIndex: number,
  toIndex: number
) => {
  const calldatas: string[] = [];
  if (fromIndex === 0) calldatas.push(airseekerRegistry.interface.encodeFunctionData('activeDataFeedCount'));
  calldatas.push(
    airseekerRegistry.interface.encodeFunctionData('getChainId'),
    ...range(fromIndex, toIndex).map((dataFeedIndex) =>
      airseekerRegistry.interface.encodeFunctionData('activeDataFeed', [dataFeedIndex])
    )
  );
  const [blockNumber, multicallResponse] = await Promise.all([
    provider.getBlockNumber(),
    airseekerRegistry.tryMulticall.staticCall(calldatas),
  ]);
  let returndatas = verifyMulticallResponse(multicallResponse);
  let activeDataFeedCountReturndata: string | undefined;
  if (fromIndex === 0) {
    activeDataFeedCountReturndata = returndatas[0]!;
    returndatas = returndatas.slice(1);
  }
  const [getChainIdReturndata, ...activeDataFeedReturndatas] = returndatas;

  // Check that the chain ID is correct and log a warning if it's not because it's possible that providers switch chain
  // ID at runtime by mistake. In case the chain ID is wrong, we want to skip all data feeds in the batch (or all of
  // them in case this is the first batch). Another possibility of a wrong chain ID is misconfiguration in airseeker
  // file.
  const contractChainId = decodeGetChainIdResponse(getChainIdReturndata!).toString();
  if (contractChainId !== chainId) {
    logger.warn(`Chain ID mismatch.`, { chainId, contractChainId });
    return null;
  }

  // In the first batch we may have asked for a non-existent data feed. We need to slice them off based on the active
  // data feed count.
  let activeDataFeedCount: number | undefined;
  let batchReturndata = activeDataFeedReturndatas;
  if (fromIndex === 0) {
    activeDataFeedCount = decodeActiveDataFeedCountResponse(activeDataFeedCountReturndata!);
    batchReturndata = activeDataFeedReturndatas.slice(0, activeDataFeedCount);
  }
  const batch = batchReturndata
    .map((dataFeedReturndata) => decodeActiveDataFeedResponse(airseekerRegistry, dataFeedReturndata))
    .filter((dataFeed, dataFeedIndex): dataFeed is DecodedActiveDataFeedResponse => {
      const isRegistered = dataFeed !== null;
      if (!isRegistered) logger.warn(`Data feed not registered.`, { dataFeedIndex });
      return isRegistered;
    });

  return {
    batch,
    blockNumber,
    activeDataFeedCount,
  };
};

export const runUpdateFeeds = async (providerName: string, chain: Chain, chainId: string) => {
  await logger.runWithContext(
    { chainName: chain.alias, providerName, updateFeedsCoordinatorId: generateRandomId() },
    async () => {
      logger.info(`Running update feeds loop.`, { currentTime: new Date().toISOString() });

      // We do not expect this function to throw, but its possible that some execution path is incorrectly handled and we
      // want to process the error ourselves, for example log the error using the configured format.
      const goRunUpdateFeeds = await go(async () => {
        const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts, alias } = chain;
        const dataFeedUpdateIntervalMs = dataFeedUpdateInterval * 1000;

        // Create a provider and connect it to the AirseekerRegistry contract.
        const provider = await createProvider(chainId, alias, providers[providerName]!.url);
        if (!provider) return;

        const airseekerRegistry = getAirseekerRegistry(contracts.AirseekerRegistry, provider);

        logger.debug(`Fetching first batch of data feeds batches.`);
        const firstBatchStartTimeMs = Date.now();
        const goFirstBatch = await go(
          async () => readActiveDataFeedBatch(provider, airseekerRegistry, chainId, 0, dataFeedBatchSize),
          { totalTimeoutMs: dataFeedUpdateIntervalMs }
        );
        if (!goFirstBatch.success) {
          logger.error(`Failed to get first active data feeds batch.`, sanitizeEthersError(goFirstBatch.error));
          return;
        }

        if (goFirstBatch.data === null) return;
        const { batch: firstBatch, activeDataFeedCount, blockNumber: firstBatchBlockNumber } = goFirstBatch.data;
        if (activeDataFeedCount === 0) {
          logger.info(`No active data feeds found.`);
          return;
        }
        // NOTE: We need to explicitly handle the .catch here because it's possible that the promise settles before it's
        // awaited, causing unhandled promise rejection. We do not expect this function to throw, but we want the promise
        // chain to be handled correctly in case there is some unhandled error.
        const processFirstBatchPromise: Promise<Error> | ReturnType<typeof processBatch> = processBatch(
          firstBatch,
          providerName,
          provider,
          chainId,
          firstBatchBlockNumber
        ).catch((error) => error);

        // Calculate the stagger time.
        const batchesCount = Math.ceil(activeDataFeedCount! / dataFeedBatchSize);
        const firstBatchDurationMs = Date.now() - firstBatchStartTimeMs;
        const staggerTimeMs = calculateStaggerTimeMs(batchesCount, firstBatchDurationMs, dataFeedUpdateIntervalMs);

        // Wait the remaining stagger time required after fetching the first batch.
        await sleep(Math.max(0, staggerTimeMs - firstBatchDurationMs));

        // Fetch the rest of the batches in parallel in a staggered way and process them.
        if (batchesCount > 1) {
          logger.debug('Fetching batches of active data feeds.', { batchesCount, staggerTimeMs });
        }
        const processOtherBatchesPromises = range(1, batchesCount).map(async (batchIndex) => {
          await sleep((batchIndex - 1) * staggerTimeMs);

          const goBatch = await go(async () => {
            logger.debug(`Fetching batch of active data feeds.`, { batchIndex });
            const dataFeedBatchIndexStart = batchIndex * dataFeedBatchSize;
            const dataFeedBatchIndexEnd = Math.min(activeDataFeedCount!, dataFeedBatchIndexStart + dataFeedBatchSize);
            const activeBatch = await readActiveDataFeedBatch(
              provider,
              airseekerRegistry,
              chainId,
              dataFeedBatchIndexStart,
              dataFeedBatchIndexEnd
            );

            return activeBatch;
          });
          if (!goBatch.success) {
            logger.error(`Failed to get active data feeds batch.`, sanitizeEthersError(goBatch.error));
            return;
          }
          if (goBatch.data === null) return;
          const { batch, blockNumber } = goBatch.data;

          return processBatch(batch, providerName, provider, chainId, blockNumber);
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
        const dataFeedUpdates = processedBatches.reduce((acc, batch) => acc + (batch ? batch.successCount : 0), 0);
        const dataFeedUpdateFailures = processedBatches.reduce((acc, batch) => acc + (batch ? batch.errorCount : 0), 0);
        logger.info(`Finished processing batches of active data feeds.`, {
          skippedBatchesCount,
          dataFeedUpdates,
          dataFeedUpdateFailures,
          activeDataFeedCount,
        });

        // Merge the signed API URLs and active beacons from all the batches.
        const signedApiUrlsFromConfig = uniq(
          processedBatches.filter(Boolean).flatMap((batch) => batch.signedApiUrlsFromConfig)
        );
        const signedApiUrlsFromContract = uniq(
          processedBatches.filter(Boolean).flatMap((batch) => batch.signedApiUrlsFromContract)
        );
        const beaconIds = uniq(processedBatches.filter(Boolean).flatMap((batch) => batch.beaconIds));
        // Overwrite the state with the new signed API URLs instead of merging them to avoid keeping stale URLs.
        updateState((draft) => {
          set(draft, ['signedApiUrlsFromConfig', chainId, providerName], signedApiUrlsFromConfig);
          set(draft, ['signedApiUrlsFromContract', chainId, providerName], signedApiUrlsFromContract);
          set(draft, ['activeDataFeedBeaconIds', chainId, providerName], beaconIds);
        });
      });

      if (!goRunUpdateFeeds.success) {
        logger.error(`Unexpected error when updating data feeds feeds.`, sanitizeEthersError(goRunUpdateFeeds.error));
      }
    }
  );
};

export const processBatch = async (
  batch: DecodedActiveDataFeedResponse[],
  providerName: string,
  provider: ethers.JsonRpcProvider,
  chainId: string,
  blockNumber: number
) => {
  logger.info('Processing batch of active data feeds.', {
    dapiNames: batch.map((dataFeed) => dataFeed.decodedDapiName),
    dataFeedIds: batch.map((dataFeed) => dataFeed.dataFeedId),
    blockNumber,
  });
  const {
    config: {
      chains,
      deviationThresholdCoefficient,
      asyncBeaconUpdatedeviationThresholdFactor,
      heartbeatIntervalModifier,
      signedApiUrls: configSignedApiBaseUrls,
    },
  } = getState();
  const { contracts } = chains[chainId]!;

  const feedsToUpdate = getUpdatableFeeds(
    batch,
    deviationThresholdCoefficient,
    heartbeatIntervalModifier,
    asyncBeaconUpdatedeviationThresholdFactor
  );

  updatePendingTransactionsInfo(chainId, providerName, batch, feedsToUpdate);

  // Fetch the gas price regardless of whether there are any feeds to be updated or not in order for gas oracle to
  // maintain historical gas prices.
  await fetchAndStoreGasPrice(chainId, providerName, provider);

  const successCount = await submitTransactions(
    chainId,
    providerName,
    provider,
    getApi3ServerV1(contracts.Api3ServerV1, provider),
    feedsToUpdate,
    blockNumber
  );

  // Generate signed API URLs for the batch.
  const signedApiUrlsFromConfig = batch.flatMap((dataFeed) =>
    dataFeed.beaconsWithData.flatMap((beacon) =>
      configSignedApiBaseUrls.map((baseUrl) => `${baseUrl}/${beacon.airnodeAddress}`)
    )
  );
  const signedApiUrlsFromContract = batch.flatMap((dataFeed) =>
    dataFeed.beaconsWithData.flatMap((beacon, index) => {
      // NOTE: contractSignedApiBaseUrl is an array of empty strings if it's not set on-chain
      const contractSignedApiBaseUrl = dataFeed.signedApiUrls[index];
      return contractSignedApiBaseUrl ? [`${contractSignedApiBaseUrl}/${beacon.airnodeAddress}`] : [];
    })
  );
  // Get the beacon IDs for the active data feeds.
  const beaconIds = batch.flatMap((dataFeed) => dataFeed.beaconsWithData.map((beacon) => beacon.beaconId));

  return {
    signedApiUrlsFromConfig,
    signedApiUrlsFromContract,
    beaconIds,
    successCount,
    errorCount: size(feedsToUpdate) - successCount,
  };
};
