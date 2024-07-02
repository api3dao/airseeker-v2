import type { Hex } from '@api3/commons';
import type { AirseekerRegistry } from '@api3/contracts';
import { ethers, toBeHex } from 'ethers';
import { omit } from 'lodash';

import { generateTestConfig } from '../../test/fixtures/mock-config';
import { generateMockAirseekerRegistry, generateActiveDataFeedResponse } from '../../test/fixtures/mock-contract';
import { allowPartial } from '../../test/utils';
import type { Chain } from '../config/schema';
import * as gasPriceModule from '../gas-price';
import { logger } from '../logger';
import * as stateModule from '../state';
import * as utilsModule from '../utils';

import * as contractsModule from './contracts';
import * as getUpdatableFeedsModule from './get-updatable-feeds';
import * as submitTransactionModule from './submit-transactions';
import * as updateFeedsLoopsModule from './update-feeds-loops';

describe(updateFeedsLoopsModule.startUpdateFeedsLoops.name, () => {
  it('starts staggered update loops for a chain', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '123': {
              alias: 'chain-123',
              dataFeedUpdateInterval: 0.1, // Have just 100 ms update interval to make the test run quicker.
              providers: {
                'first-provider': { url: 'first-provider-url' },
                'second-provider': { url: 'second-provider-url' },
              },
            },
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(updateFeedsLoopsModule, 'runUpdateFeeds').mockImplementation();
    const intervalCalls = [] as number[];
    jest.spyOn(global, 'setInterval').mockImplementation((() => {
      intervalCalls.push(Date.now());
    }) as any);
    jest.spyOn(logger, 'debug');

    await updateFeedsLoopsModule.startUpdateFeedsLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeGreaterThanOrEqual(40); // Reserving 10ms as the buffer for computing stagger time.

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(3);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Starting update loops for chain.', {
      chainName: 'chain-123',
      staggerTimeMs: 50,
      providerNames: ['first-provider', 'second-provider'],
    });
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Starting update feeds loop.', {
      chainName: 'chain-123',
      providerName: 'first-provider',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Starting update feeds loop.', {
      chainName: 'chain-123',
      providerName: 'second-provider',
    });
  });

  it('starts the update loops in parallel for each chain', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '123': {
              alias: 'chain-123',
              dataFeedUpdateInterval: 0.1,
              providers: {
                'first-provider': { url: 'first-provider-url' },
              },
            },
            '456': {
              alias: 'chain-456',
              dataFeedUpdateInterval: 0.1,
              providers: {
                'another-provider': { url: 'another-provider-url' },
              },
            },
          },
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(updateFeedsLoopsModule, 'runUpdateFeeds').mockImplementation();
    const intervalCalls = [] as number[];
    jest.spyOn(global, 'setInterval').mockImplementation((() => {
      intervalCalls.push(Date.now());
    }) as any);
    jest.spyOn(logger, 'debug');

    await updateFeedsLoopsModule.startUpdateFeedsLoops();

    // Expect the intervals to be called with the correct stagger time.
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(intervalCalls[1]! - intervalCalls[0]!).toBeLessThan(50); // Ensures that the loops are run in parallel.

    // Expect the logs to be called with the correct context.
    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Starting update loops for chain.', {
      chainName: 'chain-123',
      staggerTimeMs: 100,
      providerNames: ['first-provider'],
    });
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Starting update feeds loop.', {
      chainName: 'chain-123',
      providerName: 'first-provider',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Starting update loops for chain.', {
      chainName: 'chain-456',
      staggerTimeMs: 100,
      providerNames: ['another-provider'],
    });
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Starting update feeds loop.', {
      chainName: 'chain-456',
      providerName: 'another-provider',
    });
  });
});

describe(updateFeedsLoopsModule.runUpdateFeeds.name, () => {
  it('aborts when fetching first data feed batch fails', async () => {
    const getBlockNumberSpy = jest.fn().mockResolvedValue(123n);
    jest
      .spyOn(contractsModule, 'createProvider')
      .mockResolvedValue({ getBlockNumber: getBlockNumberSpy } as any as ethers.JsonRpcProvider);

    const airseekerRegistry = generateMockAirseekerRegistry();
    jest
      .spyOn(contractsModule, 'getAirseekerRegistry')
      .mockReturnValue(airseekerRegistry as unknown as AirseekerRegistry);
    airseekerRegistry.tryMulticall.staticCall.mockRejectedValueOnce(new Error('provider-error'));
    jest.spyOn(logger, 'error');

    await updateFeedsLoopsModule.runUpdateFeeds(
      'provider-name',
      allowPartial<Chain>({
        dataFeedBatchSize: 2,
        dataFeedUpdateInterval: 10,
        providers: { ['provider-name']: { url: 'provider-url' } },
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
      }),
      '123'
    );

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to get first active data feeds batch.',
      new Error('provider-error')
    );
  });

  it('handles error when fetching block number call fails', async () => {
    // Prepare the mocked contract so it returns two batch (of size 2) of data feeds.
    const firstDataFeed = generateActiveDataFeedResponse();
    const secondDataFeed = generateActiveDataFeedResponse();
    const getBlockNumberSpy = jest.fn();
    // Prepare the first batch to be fetched successfully and the second batch to fail.
    getBlockNumberSpy.mockResolvedValueOnce(123n);
    getBlockNumberSpy.mockRejectedValueOnce(new Error('provider-error-get-block-number'));
    jest
      .spyOn(contractsModule, 'createProvider')
      .mockResolvedValue({ getBlockNumber: getBlockNumberSpy } as any as ethers.JsonRpcProvider);

    const airseekerRegistry = generateMockAirseekerRegistry();
    jest
      .spyOn(contractsModule, 'getAirseekerRegistry')
      .mockReturnValue(airseekerRegistry as unknown as AirseekerRegistry);
    airseekerRegistry.interface.decodeFunctionResult.mockImplementation((_fn, value) => value);
    const chainId = BigInt(31_337);
    airseekerRegistry.tryMulticall.staticCall.mockResolvedValueOnce({
      successes: [true, true, true],
      returndata: [2n, chainId, firstDataFeed],
    });
    airseekerRegistry.tryMulticall.staticCall.mockResolvedValueOnce({
      successes: [true, true],
      returndata: [chainId, secondDataFeed],
    });

    jest.spyOn(logger, 'error');
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(updateFeedsLoopsModule, 'processBatch').mockResolvedValueOnce({
      signedApiUrlsFromConfig: [],
      signedApiUrlsFromContract: [],
      beaconIds: [],
      successCount: 1,
      errorCount: 0,
    });

    await updateFeedsLoopsModule.runUpdateFeeds(
      'provider-name',
      allowPartial<Chain>({
        dataFeedBatchSize: 1,
        dataFeedUpdateInterval: 0.3, // 300ms update interval to make the test run quicker.
        providers: { ['provider-name']: { url: 'provider-url' } },
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
      }),
      '31337'
    );

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to get active data feeds batch.',
      new Error('provider-error-get-block-number')
    );
    // Expect the processBatch to be called only once for the first batch.
    expect(updateFeedsLoopsModule.processBatch).toHaveBeenCalledTimes(1);
  });

  it('fetches and processes other batches in a staggered way and logs errors', async () => {
    // Prepare the mocked contract so it returns three batches (of size 1) of data feeds and the second batch fails to load.
    const firstDataFeed = generateActiveDataFeedResponse();
    const thirdDataFeed = generateActiveDataFeedResponse();
    const decodedFirstDataFeed = {
      ...omit(firstDataFeed, ['dataFeedDetails', 'beaconValues', 'beaconTimestamps']),
      decodedDapiName: utilsModule.decodeDapiName(firstDataFeed.dapiName),
      decodedUpdateParameters: contractsModule.decodeUpdateParameters(firstDataFeed.updateParameters),
      beaconsWithData: contractsModule.createBeaconsWithData(
        contractsModule.decodeDataFeedDetails(firstDataFeed.dataFeedDetails)!,
        firstDataFeed.beaconValues,
        firstDataFeed.beaconTimestamps
      ),
    } as contractsModule.DecodedActiveDataFeedResponse;
    const decodedThirdDataFeed = {
      ...omit(thirdDataFeed, ['dataFeedDetails', 'beaconValues', 'beaconTimestamps']),
      decodedDapiName: utilsModule.decodeDapiName(thirdDataFeed.dapiName),
      decodedUpdateParameters: contractsModule.decodeUpdateParameters(thirdDataFeed.updateParameters),
      beaconsWithData: contractsModule.createBeaconsWithData(
        contractsModule.decodeDataFeedDetails(thirdDataFeed.dataFeedDetails)!,
        thirdDataFeed.beaconValues,
        thirdDataFeed.beaconTimestamps
      ),
    } as contractsModule.DecodedActiveDataFeedResponse;
    const airseekerRegistry = generateMockAirseekerRegistry();
    const getBlockNumberSpy = jest.fn().mockResolvedValue(123n);
    const getGasPriceSpy = jest.fn().mockResolvedValue(toBeHex(ethers.parseUnits('5', 'gwei')));
    jest
      .spyOn(contractsModule, 'createProvider')
      .mockResolvedValue({ send: getGasPriceSpy, getBlockNumber: getBlockNumberSpy } as any as ethers.JsonRpcProvider);
    jest
      .spyOn(contractsModule, 'getAirseekerRegistry')
      .mockReturnValue(airseekerRegistry as unknown as AirseekerRegistry);
    airseekerRegistry.interface.decodeFunctionResult.mockImplementation((_fn, value) => value);
    const chainId = BigInt(31_337);
    airseekerRegistry.tryMulticall.staticCall.mockResolvedValueOnce({
      successes: [true, true, true],
      returndata: [3n, chainId, firstDataFeed],
    });
    airseekerRegistry.tryMulticall.staticCall.mockResolvedValueOnce({
      successes: [true, false],
      returndata: [chainId, '0x'],
    });
    airseekerRegistry.tryMulticall.staticCall.mockResolvedValueOnce({
      successes: [true, true],
      returndata: [chainId, thirdDataFeed],
    });
    const sleepCalls = [] as number[];
    const originalSleep = utilsModule.sleep;
    jest.spyOn(utilsModule, 'sleep').mockImplementation(async (ms) => {
      sleepCalls.push(ms);
      return originalSleep(ms);
    });
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'error');

    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: testConfig,
        signedApiUrlsFromConfig: {},
        signedApiUrlsFromContract: {},
        signedDatas: {},
        gasPrices: {},
        pendingTransactionsInfo: { '31337': { 'provider-name': {} } },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest
      .spyOn(getUpdatableFeedsModule, 'getUpdatableFeeds')
      .mockReturnValue([
        allowPartial<getUpdatableFeedsModule.UpdatableDataFeed>({
          dataFeedInfo: decodedFirstDataFeed,
        }),
      ])
      .mockReturnValue([
        allowPartial<getUpdatableFeedsModule.UpdatableDataFeed>({
          dataFeedInfo: decodedThirdDataFeed,
        }),
      ]);
    jest.spyOn(submitTransactionModule, 'submitTransactions').mockResolvedValue(0);
    const processBatchCalls = [] as number[];
    const originalProcessBatch = updateFeedsLoopsModule.processBatch;
    jest
      .spyOn(updateFeedsLoopsModule, 'processBatch')
      .mockImplementation(async (...args: Parameters<typeof originalProcessBatch>) => {
        processBatchCalls.push(Date.now());
        return originalProcessBatch(...args);
      });

    await updateFeedsLoopsModule.runUpdateFeeds(
      'provider-name',
      allowPartial<Chain>({
        dataFeedBatchSize: 1,
        dataFeedUpdateInterval: 0.3, // 300ms update interval to make the test run quicker.
        providers: { ['provider-name']: { url: 'provider-url' } },
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
      }),
      '31337'
    );

    // Expect the contract to fetch the batches to be called with the correct stagger time.
    expect(utilsModule.sleep).toHaveBeenCalledTimes(3);
    expect(sleepCalls[0]).toBeGreaterThan(0); // The first stagger time is computed dynamically (the execution time is subtracted from the interval time) which is slow on CI, so we just check it's non-zero.
    expect(sleepCalls[1]).toBe(0);
    expect(sleepCalls[2]).toBe(100);

    // Expect the call times of processBatch to be staggered as well.
    expect(updateFeedsLoopsModule.processBatch).toHaveBeenCalledTimes(2);
    expect(processBatchCalls[1]! - processBatchCalls[0]!).toBeGreaterThan(200 - 20); // The stagger time is 100ms, but second batch fails to load which means the third second processBatch call needs to happen after we wait for 2 stagger times. We add some buffer to account for processing delays.

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to get active data feeds batch.',
      new Error('One of the multicalls failed')
    );
    expect(logger.debug).toHaveBeenCalledTimes(8);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching first batch of data feeds batches.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Derived new sponsor wallet.', {
      sponsorAddress: expect.any(String),
      sponsorWalletAddress: '0x4Fe33c7f5E9407c8A27B97144c98759C88B5b8dE',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Fetching gas price and saving it to the state.');
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Fetching batches of active data feeds.', {
      batchesCount: 3,
      staggerTimeMs: 100,
    });
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Fetching batch of active data feeds.', {
      batchIndex: 1,
    });
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Fetching batch of active data feeds.', {
      batchIndex: 2,
    });
    expect(logger.debug).toHaveBeenNthCalledWith(7, 'Derived new sponsor wallet.', {
      sponsorAddress: expect.any(String),
      sponsorWalletAddress: '0x4Fe33c7f5E9407c8A27B97144c98759C88B5b8dE',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(8, 'Fetching gas price and saving it to the state.');

    expect(logger.info).toHaveBeenCalledTimes(6);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Running update feeds loop.', expect.anything());
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Processing batch of active data feeds.', expect.anything());
    expect(logger.info).toHaveBeenNthCalledWith(3, 'Updating pending transaction info.', expect.anything());
    expect(logger.info).toHaveBeenNthCalledWith(4, 'Processing batch of active data feeds.', expect.anything());
    expect(logger.info).toHaveBeenNthCalledWith(5, 'Updating pending transaction info.', expect.anything());
    expect(logger.info).toHaveBeenNthCalledWith(6, 'Finished processing batches of active data feeds.', {
      dataFeedUpdateFailures: 2,
      dataFeedUpdates: 0,
      skippedBatchesCount: 1,
      activeDataFeedCount: 3,
    });
  });

  it('catches unhandled error', async () => {
    const dataFeed = generateActiveDataFeedResponse();
    const airseekerRegistry = generateMockAirseekerRegistry();
    const getBlockNumberSpy = jest.fn().mockResolvedValue(123n);
    jest
      .spyOn(contractsModule, 'createProvider')
      .mockResolvedValue({ getBlockNumber: getBlockNumberSpy } as any as ethers.JsonRpcProvider);
    jest
      .spyOn(contractsModule, 'getAirseekerRegistry')
      .mockReturnValue(airseekerRegistry as unknown as AirseekerRegistry);
    airseekerRegistry.interface.decodeFunctionResult.mockImplementation((_fn, value) => value);
    const chainId = BigInt(31_337);
    airseekerRegistry.tryMulticall.staticCall.mockResolvedValueOnce({
      successes: [true, true, true],
      returndata: [1n, chainId, dataFeed],
    });
    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: testConfig,
        signedApiUrlsFromConfig: {},
        signedApiUrlsFromContract: {},
        signedDatas: {},
        gasPrices: {},
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'error');

    // Assume there is some unhanded error in getUpdatableFeeds.
    jest.spyOn(getUpdatableFeedsModule, 'getUpdatableFeeds').mockImplementation((): any => {
      throw new Error('unexpected-unhandled-error');
    });

    await updateFeedsLoopsModule.runUpdateFeeds(
      'provider-name',
      allowPartial<Chain>({
        dataFeedBatchSize: 1,
        dataFeedUpdateInterval: 0.1,
        providers: { ['provider-name']: { url: 'provider-url' } },
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
      }),
      '31337'
    );

    // Expect the logs to be called with the correct context.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Unexpected error when updating data feeds feeds.',
      new Error('unexpected-unhandled-error')
    );
  });
});

describe(updateFeedsLoopsModule.processBatch.name, () => {
  it('applies deviationThresholdCoefficient from config', () => {
    const dataFeed = generateActiveDataFeedResponse();
    const beacons = contractsModule.decodeDataFeedDetails(dataFeed.dataFeedDetails)!;
    const decodedUpdateParameters = contractsModule.decodeUpdateParameters(dataFeed.updateParameters);
    const activeDataFeed = {
      ...omit(dataFeed, ['dataFeedDetails', 'beaconValues', 'beaconTimestamps']),
      decodedUpdateParameters,
      beaconsWithData: contractsModule.createBeaconsWithData(beacons, dataFeed.beaconValues, dataFeed.beaconTimestamps),
      decodedDapiName: utilsModule.decodeDapiName(dataFeed.dapiName),
    } as contractsModule.DecodedActiveDataFeedResponse;
    jest.spyOn(Date, 'now').mockReturnValue(Number(dataFeed.dataFeedTimestamp) * 1000);
    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: testConfig,
        signedApiUrlsFromConfig: {},
        signedApiUrlsFromContract: {},
        signedDatas: {
          '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6': {
            airnode: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
            templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
            encodedValue: ethers.AbiCoder.defaultAbiCoder().encode(
              ['int256'],
              [
                BigInt(
                  (dataFeed.dataFeedValue *
                    // Multiply the new value by the on-chain deviationThresholdInPercentage
                    (decodedUpdateParameters.deviationThresholdInPercentage + 10n ** 8n)) /
                    10n ** 8n
                ),
              ]
            ),
            signature:
              '0x0fe25ad7debe4d018aa53acfe56d84f35c8bedf58574611f5569a8d4415e342311c093bfe0648d54e0a02f13987ac4b033b24220880638df9103a60d4f74090b1c',
            timestamp: (dataFeed.dataFeedTimestamp + 1n).toString(),
          },
        },
        gasPrices: {},
        pendingTransactionsInfo: { '31337': { 'default-provider': {} } },
      })
    );
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'info');

    const feeds = getUpdatableFeedsModule.getUpdatableFeeds([activeDataFeed], 2, 0, undefined);

    expect(logger.warn).toHaveBeenCalledTimes(0);
    expect(feeds).toStrictEqual([]);
  });

  it('generates airnode-populated signed api urls when both config and contract defines base url', async () => {
    const dataFeed = generateActiveDataFeedResponse();
    const beacons = contractsModule.decodeDataFeedDetails(dataFeed.dataFeedDetails)!;
    const decodedUpdateParameters = contractsModule.decodeUpdateParameters(dataFeed.updateParameters);
    const activeDataFeed = {
      ...omit(dataFeed, ['dataFeedDetails', 'beaconValues', 'beaconTimestamps']),
      decodedUpdateParameters,
      beaconsWithData: contractsModule.createBeaconsWithData(beacons, dataFeed.beaconValues, dataFeed.beaconTimestamps),
      decodedDapiName: utilsModule.decodeDapiName(dataFeed.dapiName),
    } as contractsModule.DecodedActiveDataFeedResponse;
    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: { ...testConfig, signedApiUrls: ['http://config.url'] },
        signedApiUrlsFromConfig: {},
        signedApiUrlsFromContract: {},
        pendingTransactionsInfo: { '31337': { 'default-provider': {} } },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'info');

    // Skip actions other than generating signed api urls.
    jest.spyOn(gasPriceModule, 'fetchAndStoreGasPrice').mockImplementation();
    jest.spyOn(getUpdatableFeedsModule, 'getUpdatableFeeds').mockReturnValue([]);
    jest.spyOn(submitTransactionModule, 'getDerivedSponsorWallet').mockReturnValue(ethers.Wallet.createRandom());

    const { signedApiUrlsFromConfig, signedApiUrlsFromContract } = await updateFeedsLoopsModule.processBatch(
      [activeDataFeed],
      'default-provider',
      new ethers.JsonRpcProvider(),
      '31337',
      123
    );

    expect(signedApiUrlsFromConfig).toHaveLength(1);
    expect(signedApiUrlsFromConfig).toContain('http://config.url/0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4');
    expect(signedApiUrlsFromContract).toHaveLength(1);
    expect(signedApiUrlsFromContract).toContain('http://localhost:8080/0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4');
  });

  it('generates airnode-populated signed api urls when only config defines base url', async () => {
    const dataFeed = generateActiveDataFeedResponse();
    const beacons = contractsModule.decodeDataFeedDetails(dataFeed.dataFeedDetails)!;
    const decodedUpdateParameters = contractsModule.decodeUpdateParameters(dataFeed.updateParameters);
    const activeDataFeed = {
      ...omit(dataFeed, ['dataFeedDetails', 'beaconValues', 'beaconTimestamps']),
      decodedUpdateParameters,
      beaconsWithData: contractsModule.createBeaconsWithData(beacons, dataFeed.beaconValues, dataFeed.beaconTimestamps),
      decodedDapiName: utilsModule.decodeDapiName(dataFeed.dapiName),
      signedApiUrls: [],
    } as contractsModule.DecodedActiveDataFeedResponse;
    const testConfig = generateTestConfig();
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: { ...testConfig, signedApiUrls: ['http://config.url'] },
        signedApiUrlsFromConfig: {},
        signedApiUrlsFromContract: {},
        pendingTransactionsInfo: { '31337': { 'default-provider': {} } },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'info');

    // Skip actions other than generating signed api urls.
    jest.spyOn(gasPriceModule, 'fetchAndStoreGasPrice').mockImplementation();
    jest.spyOn(getUpdatableFeedsModule, 'getUpdatableFeeds').mockReturnValue([]);
    jest.spyOn(submitTransactionModule, 'getDerivedSponsorWallet').mockReturnValue(ethers.Wallet.createRandom());

    const { signedApiUrlsFromConfig } = await updateFeedsLoopsModule.processBatch(
      [activeDataFeed],
      'default-provider',
      new ethers.JsonRpcProvider(),
      '31337',
      123
    );

    expect(signedApiUrlsFromConfig).toHaveLength(1);
    expect(signedApiUrlsFromConfig).toContain('http://config.url/0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4');
  });

  it('does not scale gas price for the original (first) update transaction', async () => {
    const dataFeed = generateActiveDataFeedResponse();
    const beacons = contractsModule.decodeDataFeedDetails(dataFeed.dataFeedDetails)!;
    const decodedUpdateParameters = contractsModule.decodeUpdateParameters(dataFeed.updateParameters);
    const activeDataFeed = {
      ...omit(dataFeed, ['dataFeedDetails', 'beaconValues', 'beaconTimestamps']),
      decodedUpdateParameters,
      beaconsWithData: contractsModule.createBeaconsWithData(beacons, dataFeed.beaconValues, dataFeed.beaconTimestamps),
      decodedDapiName: utilsModule.decodeDapiName(dataFeed.dapiName),
      signedApiUrls: [],
    } as contractsModule.DecodedActiveDataFeedResponse;
    const testConfig = generateTestConfig();
    stateModule.setInitialState(testConfig);
    stateModule.updateState(() =>
      allowPartial<stateModule.State>({
        config: testConfig,
        signedApiUrlsFromConfig: {},
        signedApiUrlsFromContract: {},
        gasPrices: {
          '31337': {
            'default-provider': [{ price: 10n ** 9n, timestamp: 123 }],
          },
        },
        pendingTransactionsInfo: { '31337': { 'default-provider': {} } },
      })
    );
    jest.spyOn(logger, 'warn');
    jest.spyOn(logger, 'info');
    const provider = new ethers.JsonRpcProvider();
    jest.spyOn(provider, 'getTransactionCount').mockResolvedValue(123);

    // Skip actions other than generating signed api urls.
    jest.spyOn(gasPriceModule, 'fetchAndStoreGasPrice').mockImplementation();
    jest.spyOn(getUpdatableFeedsModule, 'getUpdatableFeeds').mockReturnValue([
      allowPartial<getUpdatableFeedsModule.UpdatableDataFeed>({
        dataFeedInfo: {
          dapiName: dataFeed.dapiName as Hex,
          dataFeedId: dataFeed.dataFeedId as Hex,
        },
      }),
    ]);
    jest.spyOn(submitTransactionModule, 'getDerivedSponsorWallet').mockReturnValue(ethers.Wallet.createRandom());
    jest.spyOn(gasPriceModule, 'fetchAndStoreGasPrice').mockImplementation();
    jest.spyOn(submitTransactionModule, 'submitUpdate').mockImplementation();

    await updateFeedsLoopsModule.processBatch([activeDataFeed], 'default-provider', provider, '31337', 123);

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Processing batch of active data feeds.', expect.anything());
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Updating pending transaction info.', expect.anything());
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });
});

describe(updateFeedsLoopsModule.calculateStaggerTimeMs.name, () => {
  it('calculates zero stagger time for specific edge cases', () => {
    expect(updateFeedsLoopsModule.calculateStaggerTimeMs(1, 10_000, 60_000)).toBe(0); // When there is only a single batch.
    expect(updateFeedsLoopsModule.calculateStaggerTimeMs(2, 25_000, 30_000)).toBe(0); // When there are just two batches and fetching the first batch takes too long.
  });

  it('uses remaining time to calculate stagger time when fetching batch takes too long', () => {
    expect(updateFeedsLoopsModule.calculateStaggerTimeMs(3, 15_000, 30_000)).toBe(7500);
    expect(updateFeedsLoopsModule.calculateStaggerTimeMs(10, 10_000, 50_000)).toBe(4444);
    expect(updateFeedsLoopsModule.calculateStaggerTimeMs(10, 20_000, 20_000)).toBe(0);
  });

  it('staggers the batches evenly', () => {
    const firstBatchDuration = 10_000;
    const batchCount = 11;
    const staggerTimeMs = updateFeedsLoopsModule.calculateStaggerTimeMs(batchCount, firstBatchDuration, 50_000);

    const fetchTimes = [0, firstBatchDuration];
    for (let i = 1; i < batchCount - 1; i++) {
      fetchTimes.push(fetchTimes[1]! + staggerTimeMs * i);
    }

    expect(fetchTimes).toStrictEqual([
      0, 10_000, 14_000, 18_000, 22_000, 26_000, 30_000, 34_000, 38_000, 42_000, 46_000,
    ]);
  });

  it('returns zero if first batch takes more than the full update interval', () => {
    expect(updateFeedsLoopsModule.calculateStaggerTimeMs(3, 60_000, 30_000)).toBe(0);
  });
});
