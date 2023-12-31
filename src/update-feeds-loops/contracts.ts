import { Api3ServerV1__factory as Api3ServerV1Factory } from '@api3/airnode-protocol-v1';
import { ethers } from 'ethers';

// NOTE: The contract is not yet published, so we generate the Typechain artifacts locally and import it from there.
import { type AirseekerRegistry, AirseekerRegistry__factory as AirseekerRegistryFactory } from '../typechain-types';
import type { DecodedDataFeed } from '../types';
import { decodeDapiName, deriveBeaconId, deriveBeaconSetId } from '../utils';

export const getApi3ServerV1 = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  Api3ServerV1Factory.connect(address, provider);

export const getAirseekerRegistry = (address: string, provider: ethers.providers.StaticJsonRpcProvider) =>
  AirseekerRegistryFactory.connect(address, provider);

export const verifyMulticallResponse = (
  response: Awaited<ReturnType<AirseekerRegistry['callStatic']['tryMulticall']>>
) => {
  const { successes, returndata } = response;

  if (!successes.every(Boolean)) throw new Error('One of the multicalls failed');
  return returndata;
};

export const decodeActiveDataFeedCountResponse = (activeDataFeedCountReturndata: string) => {
  return ethers.BigNumber.from(activeDataFeedCountReturndata).toNumber();
};

export const decodeGetBlockNumberResponse = (getBlockNumberReturndata: string) => {
  return ethers.BigNumber.from(getBlockNumberReturndata).toNumber();
};

export const decodeGetChainIdResponse = (getChainIdReturndata: string) => {
  return ethers.BigNumber.from(getChainIdReturndata).toNumber();
};

export const decodeDataFeedDetails = (dataFeed: string): DecodedDataFeed | null => {
  // The contract returns empty bytes if the data feed is not registered. See:
  // https://github.com/api3dao/dapi-management/blob/f3d39e4707c33c075a8f07aa8f8369f8dc07736f/contracts/AirseekerRegistry.sol#L209
  if (dataFeed === '0x') return null;

  // This is a hex encoded string, the contract works with bytes directly
  // 2 characters for the '0x' preamble + 32 * 2 hexadecimals for 32 bytes + 32 * 2 hexadecimals for 32 bytes
  if (dataFeed.length === 2 + 32 * 2 + 32 * 2) {
    const [airnodeAddress, templateId] = ethers.utils.defaultAbiCoder.decode(['address', 'bytes32'], dataFeed);

    const dataFeedId = deriveBeaconId(airnodeAddress, templateId)!;

    return { dataFeedId, beacons: [{ beaconId: dataFeedId, airnodeAddress, templateId }] };
  }

  const [airnodeAddresses, templateIds] = ethers.utils.defaultAbiCoder.decode(['address[]', 'bytes32[]'], dataFeed);

  const beacons = (airnodeAddresses as string[]).map((airnodeAddress: string, idx: number) => {
    const templateId = templateIds[idx] as string;
    const beaconId = deriveBeaconId(airnodeAddress, templateId)!;

    return { beaconId, airnodeAddress, templateId };
  });

  const dataFeedId = deriveBeaconSetId(beacons.map((b) => b.beaconId))!;

  return { dataFeedId, beacons };
};

export interface DecodedUpdateParameters {
  deviationReference: ethers.BigNumber;
  deviationThresholdInPercentage: ethers.BigNumber;
  heartbeatInterval: ethers.BigNumber;
}

export const decodeUpdateParameters = (updateParameters: string): DecodedUpdateParameters => {
  // https://github.com/api3dao/airnode-protocol-v1/blob/5f861715749e182e334c273d6a52c4f2560c7994/contracts/api3-server-v1/extensions/BeaconSetUpdatesWithPsp.sol#L122
  const [deviationThresholdInPercentage, deviationReference, heartbeatInterval] = ethers.utils.defaultAbiCoder.decode(
    ['uint256', 'int224', 'uint256'],
    updateParameters
  );
  // 2 characters for the '0x' preamble + 3 parameters, 32 * 2 hexadecimals for 32 bytes each
  if (updateParameters.length !== 2 + 3 * (32 * 2)) {
    throw new Error(`Unexpected trailing data in update parameters`);
  }

  return {
    deviationReference,
    deviationThresholdInPercentage,
    heartbeatInterval,
  };
};

export interface DecodedActiveDataFeedResponse {
  dapiName: string | null;
  decodedDapiName: string | null;
  decodedUpdateParameters: DecodedUpdateParameters;
  dataFeedValue: ethers.BigNumber;
  dataFeedTimestamp: number;
  decodedDataFeed: DecodedDataFeed;
  signedApiUrls: string[];
}

export const decodeActiveDataFeedResponse = (
  airseekerRegistry: AirseekerRegistry,
  activeDataFeedReturndata: string
): DecodedActiveDataFeedResponse | null => {
  const { dapiName, updateParameters, dataFeedValue, dataFeedTimestamp, dataFeedDetails, signedApiUrls } =
    airseekerRegistry.interface.decodeFunctionResult('activeDataFeed', activeDataFeedReturndata) as Awaited<
      ReturnType<AirseekerRegistry['activeDataFeed']>
    >;

  // https://github.com/api3dao/dapi-management/blob/f3d39e4707c33c075a8f07aa8f8369f8dc07736f/contracts/AirseekerRegistry.sol#L162
  const decodedDataFeed = decodeDataFeedDetails(dataFeedDetails);
  if (!decodedDataFeed) return null;

  // The dAPI name will be set to zero (in bytes32) in case the data feed is not a dAPI and is identified by a data feed
  // ID.
  const decodedDapiName = decodeDapiName(dapiName);

  return {
    dapiName: decodedDapiName === '' ? null : dapiName, // NOTE: Anywhere in the codebase the "dapiName" is the encoded version of the dAPI name.
    decodedDapiName: decodedDapiName === '' ? null : decodedDapiName,
    decodedUpdateParameters: decodeUpdateParameters(updateParameters),
    dataFeedValue,
    dataFeedTimestamp,
    decodedDataFeed,
    signedApiUrls,
  };
};
