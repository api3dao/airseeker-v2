import { getSignedData } from '../data-fetcher-loop/signed-data-state';
import { calculateMedian, isDataFeedUpdatable } from '../deviation-check';
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
}

export const getUpdatableFeeds = (
  batch: DecodedActiveDataFeedResponse[],
  deviationThresholdCoefficient: number
): UpdatableDataFeed[] => {
  return (
    batch
      // Determine on-chain and off-chain values for each beacon.
      .map((dataFeedInfo) => {
        const aggregatedBeaconsWithData = dataFeedInfo.beaconsWithData.map(({ beaconId, timestamp, value }) => {
          const onChainValue: BeaconValue = { timestamp, value };
          const signedData = getSignedData(beaconId);
          const offChainValue: BeaconValue | undefined = signedData
            ? {
                timestamp: BigInt(signedData.timestamp),
                value: decodeBeaconValue(signedData.encodedValue)!,
              }
            : undefined;
          const isUpdatable = offChainValue && offChainValue?.timestamp > onChainValue.timestamp;

          return { onChainValue, offChainValue, isUpdatable, signedData, beaconId };
        });

        return {
          dataFeedInfo,
          aggregatedBeaconsWithData,
        };
      })
      // Filter out data feeds that cannot be updated.
      .filter(({ dataFeedInfo, aggregatedBeaconsWithData }) => {
        const beaconValues = aggregatedBeaconsWithData.map(({ onChainValue, offChainValue, isUpdatable }) =>
          isUpdatable ? offChainValue! : onChainValue
        );

        const newBeaconSetValue = calculateMedian(beaconValues.map(({ value }) => value));
        const newBeaconSetTimestamp = calculateMedian(beaconValues.map(({ timestamp }) => timestamp));

        const { decodedUpdateParameters, dataFeedValue, dataFeedTimestamp } = dataFeedInfo;
        const adjustedDeviationThresholdCoefficient = multiplyBigNumber(
          decodedUpdateParameters.deviationThresholdInPercentage,
          deviationThresholdCoefficient
        );

        return isDataFeedUpdatable(
          dataFeedValue,
          dataFeedTimestamp,
          newBeaconSetValue,
          newBeaconSetTimestamp,
          decodedUpdateParameters.heartbeatInterval,
          adjustedDeviationThresholdCoefficient
        );
      })
      // Compute the updateable beacons.
      .map(({ dataFeedInfo, aggregatedBeaconsWithData }) => ({
        dataFeedInfo,
        updatableBeacons: aggregatedBeaconsWithData
          .filter(({ isUpdatable }) => isUpdatable)
          .map(({ beaconId, signedData }) => ({
            beaconId,
            signedData: signedData!,
          })),
      }))
  );
};
