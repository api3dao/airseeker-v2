import { getSignedData, isSignedDataFresh } from '../data-fetcher-loop/signed-data-state';
import { calculateMedian, checkUpdateCondition } from '../deviation-check';
import { logger } from '../logger';
import type { SignedData } from '../types';
import { decodeBeaconValue, multiplyBigNumber } from '../utils';

import type { DecodedActiveDataFeedResponse } from './contracts';

interface BeaconValue {
  timestamp: bigint;
  value: bigint;
}

export interface UpdatableBeacon {
  beaconId: string;
  signedData: SignedData;
}

export interface UpdatableDataFeed {
  dataFeedInfo: DecodedActiveDataFeedResponse;
  updatableBeacons: UpdatableBeacon[];
  shouldUpdateBeaconSet: boolean;
}

export const getUpdatableFeeds = (
  batch: DecodedActiveDataFeedResponse[],
  deviationThresholdCoefficient: number,
  heartbeatIntervalModifier: number,
  asyncBeaconUpdatedeviationThresholdFactor: number | undefined
): UpdatableDataFeed[] => {
  return batch.reduce<UpdatableDataFeed[]>((acc, dataFeedInfo) => {
    // Fetch signed data and determine the value based on on-chain and off-chain data for each beacon.
    const aggregatedBeaconsWithData = dataFeedInfo.beaconsWithData.map(({ beaconId, timestamp, value }) => {
      const onChainValue: BeaconValue = { timestamp, value };
      let signedData = getSignedData(beaconId);
      if (signedData && !isSignedDataFresh(signedData)) {
        const { airnode, templateId } = signedData;
        // This should not happen under normal circumstances. Something must be off with the Signed API.
        logger.warn("Not using the signed data because it's older than 24 hours.", {
          airnode,
          templateId,
        });
        signedData = undefined;
      }
      const offChainValue: BeaconValue | undefined = signedData
        ? {
            timestamp: BigInt(signedData.timestamp),
            value: decodeBeaconValue(signedData.encodedValue)!,
          }
        : undefined;

      const isUpdatable = offChainValue && offChainValue.timestamp > onChainValue.timestamp;

      return { isUpdatable, offChainValue, onChainValue, beaconId, signedData };
    });

    // Beacons are updatable when the off-chain timestamp is newer than the on-chain one. If we can't update the
    // timestamp, we reuse the on-chain value.
    //
    // NOTE: This guarantees that the off-chain data feed timestamp is greater or equal to the on-chain one.
    const beaconValues = aggregatedBeaconsWithData.map(({ isUpdatable, offChainValue, onChainValue }) =>
      isUpdatable ? offChainValue! : onChainValue
    );

    // Works for both beacon sets and single beacon feed.
    const newDataFeedValue = calculateMedian(beaconValues.map(({ value }) => value));
    const newDataFeedTimestamp = calculateMedian(beaconValues.map(({ timestamp }) => timestamp));

    const {
      decodedUpdateParameters: { deviationThresholdInPercentage, deviationReference, heartbeatInterval },
      dataFeedValue,
      dataFeedTimestamp,
      decodedDapiName,
      dataFeedId,
    } = dataFeedInfo;
    const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
      deviationThresholdInPercentage,
      deviationThresholdCoefficient
    );

    const modifiedHeartbeatInterval = heartbeatInterval + BigInt(heartbeatIntervalModifier);
    if (modifiedHeartbeatInterval < 0n) {
      logger.warn('Resulting heartbeat interval is negative. Setting it to 0.', {
        dapiName: decodedDapiName,
        dataFeedId,
        heartbeatInterval,
        heartbeatIntervalModifier,
      });
    }
    const adjustedHeartbeatInterval = modifiedHeartbeatInterval < 0n ? 0n : modifiedHeartbeatInterval;

    // Filter out data feeds that cannot be updated.
    const isBeaconSet = beaconValues.length > 1;

    // We need to make sure that the update transaction actually changes the on-chain value. There are two cases:
    // 1. Data feed is a beacon - We need to make sure the off-chain data updates the feed. This requires timestamp
    //    to change. See:
    //    https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/DataFeedServer.sol#L120
    const isValidBeaconUpdate = !isBeaconSet && newDataFeedTimestamp !== dataFeedTimestamp;

    // 2. Data feed is a beacon set - We need make sure that the beacon set will change. The contract requires the
    //    beacon set value or timestamp to change. See:
    //    https://github.com/api3dao/airnode-protocol-v1/blob/65a77cdc23dc5434e143357a506327b9f0ccb7ef/contracts/api3-server-v1/DataFeedServer.sol#L54
    // Note, that the beacon set value/timestamp is computed as median, so single beacon update may not result in a beacon set update.
    const isValidBeaconSetUpdate =
      isBeaconSet && (newDataFeedValue !== dataFeedValue || newDataFeedTimestamp !== dataFeedTimestamp);

    const dataFeedNeedsUpdate =
      (isValidBeaconUpdate || isValidBeaconSetUpdate) &&
      logger.runWithContext(
        {
          dapiName: decodedDapiName,
          dataFeedId,
        },
        () =>
          checkUpdateCondition(
            dataFeedValue,
            dataFeedTimestamp,
            newDataFeedValue,
            newDataFeedTimestamp,
            adjustedHeartbeatInterval,
            adjustedDeviationThresholdCoefficient,
            deviationReference
          )
      );

    if (dataFeedNeedsUpdate) {
      acc.push({
        dataFeedInfo,
        updatableBeacons: aggregatedBeaconsWithData
          .filter(({ isUpdatable }) => isUpdatable)
          .map(({ beaconId, signedData }) => ({
            beaconId,
            signedData: signedData!,
          })),
        shouldUpdateBeaconSet: isBeaconSet,
      });
    } else if (isBeaconSet && asyncBeaconUpdatedeviationThresholdFactor) {
      // 2.5. There is a special case when data feed is a beacon set that do not need to be updated but some of its beacon constituents do.
      //      In this particular case, airseeker can update only these beacons and skip the beacon set update. This is enabled by setting a
      //      value in asyncBeaconUpdatedeviationThresholdFactor on the config.
      const updatableBeacons = aggregatedBeaconsWithData
        .filter(
          ({ isUpdatable, offChainValue, onChainValue }) =>
            isUpdatable &&
            offChainValue &&
            checkUpdateCondition(
              onChainValue.value,
              onChainValue.timestamp,
              offChainValue.value,
              offChainValue.timestamp,
              adjustedHeartbeatInterval,
              adjustedDeviationThresholdCoefficient * BigInt(asyncBeaconUpdatedeviationThresholdFactor),
              deviationReference
            )
        )
        .map(({ beaconId, signedData }) => ({
          beaconId,
          signedData: signedData!,
        }));
      acc.push({
        dataFeedInfo,
        updatableBeacons,
        shouldUpdateBeaconSet: false,
      });
    }

    return acc;
  }, []);
};
