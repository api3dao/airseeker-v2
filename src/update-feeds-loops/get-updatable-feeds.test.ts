import { ethers } from 'ethers';
import { range } from 'lodash';

import { allowPartial } from '../../test/utils';
import { HUNDRED_PERCENT } from '../constants';
import * as signedDataStateModule from '../data-fetcher-loop/signed-data-state';
import * as deviationCheckModule from '../deviation-check/deviation-check';
import { logger } from '../logger';
import type { SignedData } from '../types';
import { encodeDapiName } from '../utils';

import type * as contractsModule from './contracts';
import { getUpdatableFeeds } from './get-updatable-feeds';

const ONE_PERCENT = BigInt(Number(HUNDRED_PERCENT) / 100);

// https://github.com/api3dao/airnode-protocol-v1/blob/fa95f043ce4b50e843e407b96f7ae3edcf899c32/contracts/api3-server-v1/DataFeedServer.sol#L132
const encodeBeaconValue = (numericValue: string) => {
  const numericValueAsBigNumber = BigInt(numericValue);

  return ethers.AbiCoder.defaultAbiCoder().encode(['int256'], [numericValueAsBigNumber]);
};

const feedIds = [
  '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
  '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
  '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
] as const;

describe(getUpdatableFeeds.name, () => {
  it('returns updatable feeds when value exceeds the threshold', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

    // Only the second and third feed will satisfy the timestamp check
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        timestamp: '165',
        encodedValue: encodeBeaconValue('250'),
      },
      [feedIds[2]]: {
        timestamp: '175',
        encodedValue: encodeBeaconValue('300'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 500n, 600n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(checkFeedsResult).toHaveLength(1);
    expect(checkFeedsResult[0]!.updatableBeacons).toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        signedData: {
          encodedValue: '0x00000000000000000000000000000000000000000000000000000000000000fa',
          timestamp: '165',
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        signedData: {
          encodedValue: '0x000000000000000000000000000000000000000000000000000000000000012c',
          timestamp: '175',
        },
      },
    ]);
  });

  it('adjusts heartbeat interval', () => {
    jest.useFakeTimers().setSystemTime(200 * 1000);

    const heartbeatIntervalModifier = -10;

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '400',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '500',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '600',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');
    jest.spyOn(deviationCheckModule, 'checkUpdateCondition');
    const timestamps = [150n, 199n, 250n];
    const values = [400n, 400n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 15n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        decodedDapiName: 'test',
      },
    ]);

    getUpdatableFeeds(batch, 1, heartbeatIntervalModifier, undefined);
    expect(deviationCheckModule.checkUpdateCondition).toHaveBeenCalledWith(400n, 199n, 400n, 500n, 5n, ONE_PERCENT, 0n);
  });

  it('adjusts heartbeat interval to 0 if resulting one is negative', () => {
    jest.useFakeTimers().setSystemTime(200 * 1000);

    const heartbeatIntervalModifier = -10;

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '400',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '500',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '600',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'warn');
    jest.spyOn(deviationCheckModule, 'checkUpdateCondition');
    const timestamps = [150n, 199n, 250n];
    const values = [400n, 400n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 5n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        decodedDapiName: 'test',
      },
    ]);

    getUpdatableFeeds(batch, 1, heartbeatIntervalModifier, undefined);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(`Resulting heartbeat interval is negative. Setting it to 0.`, {
      dapiName: 'test',
      dataFeedId: '0x000',
      heartbeatInterval: BigInt(5),
      heartbeatIntervalModifier: -10,
    });
    expect(deviationCheckModule.checkUpdateCondition).toHaveBeenCalledWith(400n, 199n, 400n, 500n, 0n, ONE_PERCENT, 0n);
  });

  it('returns updatable feeds when on-chain timestamp is older than heartbeat and value is within the deviation', () => {
    jest.useFakeTimers().setSystemTime(200 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '400',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '500',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '600',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 400n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 1n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`On-chain timestamp is older than the heartbeat interval.`);
    expect(checkFeedsResult).toHaveLength(1);
    expect(checkFeedsResult[0]!.updatableBeacons).toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        signedData: {
          encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
          timestamp: '400',
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        signedData: {
          encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
          timestamp: '500',
        },
      },
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
        signedData: {
          encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
          timestamp: '600',
        },
      },
    ]);
  });

  it('returns an empty array for old fulfillment data', () => {
    jest.useFakeTimers().setSystemTime(150 * 1000);

    // Mock signed data state to have stale data
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('200'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);

    // Set up batch with on-chain values that don't trigger an update
    const timestamps = [150n, 160n, 170n];
    const values = [200n, 200n, 200n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);
    jest.spyOn(logger, 'warn');

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.warn).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it('returns an empty array for on-chain data newer than heartbeat and value within the threshold', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '101',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('400'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 400n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it('does not update beacon feed if the off-chain value is not newer', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('200'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n];
    const values = [200n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it("does not update beacon set if it won't cause on-chain update", () => {
    jest.useFakeTimers().setSystemTime(500 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '110', // Changed by 10 compared to the on-chain value
        encodedValue: encodeBeaconValue('210'), // Changed by 10 compared to the on-chain value
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('300'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [300n, 300n, 300n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.info).toHaveBeenCalledTimes(0);
    expect(checkFeedsResult).toStrictEqual([]);
  });

  it("updates a beacon set even if it's timestamp doesn't change, but the value does", () => {
    jest.useFakeTimers().setSystemTime(300 * 1000);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '150', // Changed by 50 compared to the on-chain value
        encodedValue: encodeBeaconValue('350'), // Changed by 150 compared to the on-chain value
      },
      [feedIds[1]]: {
        timestamp: '150',
        encodedValue: encodeBeaconValue('300'),
      },
      [feedIds[2]]: {
        timestamp: '200',
        encodedValue: encodeBeaconValue('400'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [100n, 150n, 200n];
    const values = [200n, 300n, 400n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(checkFeedsResult).toHaveLength(1);
    expect(checkFeedsResult[0]!.updatableBeacons).toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        signedData: {
          encodedValue: '0x000000000000000000000000000000000000000000000000000000000000015e',
          timestamp: '150',
        },
      },
    ]);
  });

  it('logs a warning when some signed data is too old', () => {
    const now = Date.now();
    jest.useFakeTimers().setSystemTime(now);

    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        airnode: '0x8676eA8B6Ebe5b8FBbc25FF55192bADf39D7D61b',
        templateId: '0x9b8c129f62484aef617622caba20a58f51fdad30c39a32b1ee416b3be4a3f028',
        timestamp: String(Math.floor(now / 1000) - 23 * 60 * 60),
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
        templateId: '0xe6df5fb43a0b3a65ac1b05e7e50fba03b475fe5b721693d469554278086fd2e4',
        timestamp: String(Math.floor(now / 1000) - 24 * 60 * 60), // Too old.
        encodedValue: encodeBeaconValue('250'),
      },
      [feedIds[2]]: {
        airnode: '0xbF3137b0a7574563a23a8fC8badC6537F98197CC',
        templateId: '0x6f0c2b5c6420d1896e67e56539ccbec5e6aafee5c27f6eb8783b9731faa7205d',
        timestamp: String(Math.floor(now / 1000) - 25 * 60 * 60), // Too old.
        encodedValue: encodeBeaconValue('300'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'warn');

    const timestamps = [BigInt(now - 2 * 60 * 1000), BigInt(now - 2 * 60 * 1000), BigInt(now - 2 * 60 * 1000)];
    const values = [400n, 500n, 600n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const updatableFeeds = getUpdatableFeeds(batch, 1, 0, undefined);

    expect(updatableFeeds).toStrictEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(`Not using the signed data because it's older than 24 hours.`, {
      airnode: '0xC04575A2773Da9Cd23853A69694e02111b2c4182',
      templateId: '0xe6df5fb43a0b3a65ac1b05e7e50fba03b475fe5b721693d469554278086fd2e4',
    });
    expect(logger.warn).toHaveBeenCalledWith(`Not using the signed data because it's older than 24 hours.`, {
      airnode: '0xbF3137b0a7574563a23a8fC8badC6537F98197CC',
      templateId: '0x6f0c2b5c6420d1896e67e56539ccbec5e6aafee5c27f6eb8783b9731faa7205d',
    });
  });

  it('returns updatable feeds with beacons that need to be udpated based on asyncBeaconUpdatedeviationThresholdFactor config property', () => {
    jest.useFakeTimers().setSystemTime(90 * 1000);

    // Only the second and third feed will satisfy the timestamp check
    const mockSignedDataState = allowPartial<Record<string, SignedData>>({
      [feedIds[0]]: {
        timestamp: '155',
        encodedValue: encodeBeaconValue('200'),
      },
      [feedIds[1]]: {
        timestamp: '165',
        encodedValue: encodeBeaconValue('500'),
      },
      [feedIds[2]]: {
        timestamp: '175',
        encodedValue: encodeBeaconValue('600'),
      },
    });
    jest
      .spyOn(signedDataStateModule, 'getSignedData')
      .mockImplementation((dataFeedId: string) => mockSignedDataState[dataFeedId]!);
    jest.spyOn(logger, 'info');

    const timestamps = [150n, 160n, 170n];
    const values = [400n, 500n, 600n];
    const batch = allowPartial<contractsModule.DecodedActiveDataFeedResponse[]>([
      {
        decodedUpdateParameters: {
          deviationThresholdInPercentage: ONE_PERCENT,
          heartbeatInterval: 100n,
          deviationReference: 0n,
        },
        dataFeedValue: deviationCheckModule.calculateMedian(values),
        dataFeedTimestamp: deviationCheckModule.calculateMedian(timestamps),
        beaconsWithData: range(values.length).map((i) => ({
          beaconId: feedIds[i]!,
          timestamp: timestamps[i]!,
          value: values[i]!,
        })),
        dataFeedId: '0x000',
        dapiName: encodeDapiName('test'),
      },
    ]);

    const checkFeedsResult = getUpdatableFeeds(batch, 1, 0, 5);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(`Deviation exceeded.`);
    expect(checkFeedsResult).toHaveLength(1);
    expect(checkFeedsResult[0]!.updatableBeacons).toStrictEqual([
      {
        beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        signedData: {
          encodedValue: '0x00000000000000000000000000000000000000000000000000000000000000c8',
          timestamp: '155',
        },
      },
    ]);
  });
});
