import type { AirseekerRegistry, Api3ServerV1 } from '@api3/contracts';
import { ethers } from 'ethers';

import { encodeDapiName } from '../../src/utils';
import { encodeBeaconDetails, type DeepPartial } from '../utils';

export const generateActiveDataFeedResponse = () =>
  ({
    dapiName: encodeDapiName('MOCK_FEED'),
    dataFeedId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
    updateParameters: ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'int224', 'uint256'],
      [0.5 * 1e8, 0.5 * 1e8, 100] // deviationThresholdInPercentage, deviationReference, heartbeatInterval
    ),
    dataFeedValue: BigInt(123 * 1e6),
    dataFeedTimestamp: 1_629_811_200n,
    dataFeedDetails: encodeBeaconDetails({
      beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
      airnodeAddress: '0xc52EeA00154B4fF1EbbF8Ba39FDe37F1AC3B9Fd4',
      templateId: '0x457a3b3da67e394a895ea49e534a4d91b2d009477bef15eab8cbed313925b010',
    }),
    beaconValues: [BigInt(123 * 1e6)],
    beaconTimestamps: [1_629_811_200n],
    signedApiUrls: ['http://localhost:8080'],
  }) as Awaited<ReturnType<AirseekerRegistry['activeDataFeed']['staticCall']>>;

export const generateMockAirseekerRegistry = () => {
  return {
    interface: {
      encodeFunctionData: jest.fn(),
      decodeFunctionResult: jest.fn(),
    },
    tryMulticall: { staticCall: jest.fn(), send: jest.fn() },
    activeDataFeed: jest.fn(),
    activeDataFeedCount: jest.fn(),
  } satisfies DeepPartial<AirseekerRegistry>;
};

export const generateMockApi3ServerV1 = () => {
  return {
    multicall: { estimateGas: jest.fn() },
    updateBeaconWithSignedData: { estimateGas: jest.fn(), send: jest.fn() },
    updateBeaconSetWithBeacons: { estimateGas: jest.fn() },
    interface: {
      encodeFunctionData: jest.fn(),
    },
    connect: jest.fn(),
    tryMulticall: { staticCall: jest.fn(), send: jest.fn() },
  } satisfies DeepPartial<Api3ServerV1>;
};
