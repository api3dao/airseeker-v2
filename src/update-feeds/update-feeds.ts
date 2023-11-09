import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { range, size, zip } from 'lodash';

import { calculateMedian, checkUpdateConditions } from '../condition-check';
import type { Chain } from '../config/schema';
import { INT224_MAX, INT224_MIN } from '../constants';
import { clearSponsorLastUpdateTimestampMs } from '../gas-price/gas-price';
import { logger } from '../logger';
import { getStoreDataPoint } from '../signed-data-store';
import { getState, updateState } from '../state';
import type { ChainId, Provider } from '../types';
import { isFulfilled, sleep } from '../utils';

import { getApi3ServerV1 } from './api3-server-v1';
import {
  decodeDapisCountResponse,
  decodeReadDapiWithIndexResponse,
  getDapiDataRegistry,
  verifyMulticallResponse,
  type ReadDapiWithIndexResponse,
} from './dapi-data-registry';
import { type UpdateableDapi, deriveSponsorWallet, updateFeeds } from './update-transactions';

export const startUpdateFeedLoops = async () => {
  const state = getState();
  const {
    config: { chains },
  } = state;

  // Start update loops for each chain in parallel.
  await Promise.all(
    Object.entries(chains).map(async ([chainId, chain]) => {
      const { dataFeedUpdateInterval, providers } = chain;

      // Calculate the stagger time for each provider on the same chain to maximize transaction throughput and update
      // frequency.
      const staggerTime = (dataFeedUpdateInterval / size(providers)) * 1000;
      logger.debug(`Starting update loops for chain`, { chainId, staggerTime, providerNames: Object.keys(providers) });

      for (const providerName of Object.keys(providers)) {
        logger.debug(`Starting update feed loop`, { chainId, providerName });
        setInterval(async () => runUpdateFeed(providerName, chain, chainId), dataFeedUpdateInterval * 1000);

        await sleep(staggerTime);
      }
    })
  );
};

export const runUpdateFeed = async (providerName: Provider, chain: Chain, chainId: ChainId) => {
  await logger.runWithContext({ chainId, providerName, coordinatorTimestampMs: Date.now().toString() }, async () => {
    const { dataFeedBatchSize, dataFeedUpdateInterval, providers, contracts } = chain;

    // Create a provider and connect it to the DapiDataRegistry contract.
    const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);
    const dapiDataRegistry = getDapiDataRegistry(contracts.DapiDataRegistry, provider);

    logger.debug(`Fetching first batch of dAPIs batches`);
    const firstBatchStartTime = Date.now();
    const goFirstBatch = await go(async () => {
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
        .map((dapiReturndata) => ({ ...decodeReadDapiWithIndexResponse(dapiDataRegistry, dapiReturndata), chainId }));
      return {
        firstBatch,
        dapisCount,
      };
    });
    if (!goFirstBatch.success) {
      logger.error(`Failed to get first active dAPIs batch`, goFirstBatch.error);
      return;
    }
    const { firstBatch, dapisCount } = goFirstBatch.data;
    const processFirstBatchPromise = processBatch(firstBatch, providerName, chainId);

    // Calculate the stagger time between the rest of the batches.
    const batchesCount = Math.ceil(dapisCount / dataFeedBatchSize);
    const staggerTime = batchesCount <= 1 ? 0 : (dataFeedUpdateInterval / batchesCount) * 1000;

    // Wait the remaining stagger time required after fetching the first batch.
    const firstBatchDuration = Date.now() - firstBatchStartTime;
    await sleep(Math.max(0, staggerTime - firstBatchDuration));

    // Fetch the rest of the batches in parallel in a staggered way.
    if (batchesCount > 1) {
      logger.debug('Fetching batches of active dAPIs', { batchesCount, staggerTime });
    }
    const otherBatches = await Promise.allSettled(
      range(1, batchesCount).map(async (batchIndex) => {
        await sleep((batchIndex - 1) * staggerTime);

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
      })
    );
    for (const batch of otherBatches.filter((batch) => !isFulfilled(batch))) {
      logger.error(`Failed to get active dAPIs batch`, (batch as PromiseRejectedResult).reason);
    }
    const processOtherBatchesPromises = otherBatches
      .filter((result) => isFulfilled(result))
      .map(async (result) =>
        processBatch((result as PromiseFulfilledResult<ReadDapiWithIndexResponse[]>).value, providerName, chainId)
      );

    // Wait for all the batches to be processed.
    //
    // TODO: Consider returning some information (success/error) and log some statistics (e.g. how many dAPIs were
    // updated, etc...).
    await Promise.all([processFirstBatchPromise, ...processOtherBatchesPromises]);
  });
};

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
export const decodeBeaconValue = (encodedBeaconValue: string) => {
  const decodedBeaconValue = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(['int256'], encodedBeaconValue)[0]
  );
  if (decodedBeaconValue.gt(INT224_MAX) || decodedBeaconValue.lt(INT224_MIN)) {
    return null;
  }

  return decodedBeaconValue;
};

export const getFeedsToUpdate = (batch: ReadDapiWithIndexResponse[]): UpdateableDapi[] =>
  batch
    .map((dapiInfo): UpdateableDapi | null => {
      const beaconsSignedData = dapiInfo.decodedDataFeed.beacons.map((beacon) => getStoreDataPoint(beacon.dataFeedId));

      // Only update data feed when we have signed data for all constituent beacons.
      if (beaconsSignedData.some((signedData) => !signedData)) return null;

      const beaconsDecodedValues = beaconsSignedData.map((signedData) => decodeBeaconValue(signedData!.encodedValue));
      // Only update data feed when all beacon values are valid.
      if (beaconsDecodedValues.includes(null)) return null;

      // https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L163
      const newBeaconSetValue = calculateMedian(beaconsDecodedValues.map((decodedValue) => decodedValue!));
      const newBeaconSetTimestamp = calculateMedian(
        beaconsSignedData.map((signedData) => ethers.BigNumber.from(signedData!.timestamp))
      )!.toNumber();
      const deviationThreshold = dapiInfo.updateParameters.deviationThresholdInPercentage;
      if (
        !checkUpdateConditions(
          dapiInfo.dataFeedValue.value,
          dapiInfo.dataFeedValue.timestamp,
          newBeaconSetValue,
          newBeaconSetTimestamp,
          dapiInfo.updateParameters.heartbeatInterval,
          deviationThreshold
        )
      ) {
        return null;
      }

      return {
        dapiInfo,
        updateableBeacons: zip(dapiInfo.decodedDataFeed.beacons, beaconsSignedData).map(([beacon, signedData]) => ({
          signedData: signedData!,
          beaconId: beacon!.dataFeedId,
        })),
      };
    })
    .filter((updateableDapi): updateableDapi is UpdateableDapi => updateableDapi !== null);

export const processBatch = async (batch: ReadDapiWithIndexResponse[], providerName: Provider, chainId: string) => {
  logger.debug('Processing batch of active dAPIs', { batch });
  const {
    config: { sponsorWalletMnemonic, chains },
  } = getState();
  const { contracts, providers } = chains[chainId]!;
  const provider = new ethers.providers.StaticJsonRpcProvider(providers[providerName]);

  updateState((draft) => {
    for (const dapi of batch) {
      const receivedUrls = dapi.signedApiUrls.flatMap((url) =>
        dapi.decodedDataFeed.beacons.flatMap((dataFeed) => `${url}/${dataFeed.airnodeAddress}`)
      );

      draft.signedApiUrlStore = {
        ...draft.signedApiUrlStore,
        [chainId]: { ...draft.signedApiUrlStore[chainId], [providerName]: receivedUrls.flat() },
      };

      const cachedDapiResponse = draft.dapis[dapi.dapiName];

      draft.dapis[dapi.dapiName] = {
        dataFeed: cachedDapiResponse?.dataFeed ?? dapi.decodedDataFeed,
        dataFeedValues: { ...cachedDapiResponse?.dataFeedValues, [chainId]: dapi.dataFeedValue },
        updateParameters: { ...cachedDapiResponse?.updateParameters, [chainId]: dapi.updateParameters },
      };
    }
  });

  const feedsToUpdate = getFeedsToUpdate(batch);
  const dapiNamesToUpdate = new Set(feedsToUpdate.map((feed) => feed.dapiInfo.dapiName));

  // Clear last update timestamps for feeds that don't need an update
  for (const feed of batch) {
    if (dapiNamesToUpdate.has(feed.dapiName)) continue;

    clearSponsorLastUpdateTimestampMs(
      chainId,
      providerName,
      deriveSponsorWallet(sponsorWalletMnemonic, feed.dapiName).address
    );
  }

  return updateFeeds(chainId, providerName, provider, getApi3ServerV1(contracts.Api3ServerV1, provider), feedsToUpdate);
};
