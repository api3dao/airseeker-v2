import { clearInterval } from 'timers';
import { BigNumber, ethers } from 'ethers';
import { LocalSignedData, SignedData, AirnodeAddress, DataStore, TemplateId } from '../types';
import { logger } from '../logger';

// A simple in-memory data store implementation - the interface allows for swapping in a remote key/value store

let signedApiStore: Record<AirnodeAddress, Record<TemplateId, LocalSignedData>> = {};
let pruner: NodeJS.Timeout | undefined;

export const checkMessage = ({ airnode, templateId, timestamp, signature, encodedValue }: SignedData) => {
  // 'data' is: ethers.utils.defaultAbiCoder.encode(['int256'], [beaconValue]);

  const message = ethers.utils.arrayify(
    ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
  );

  const signerAddr = ethers.utils.verifyMessage(message, signature);
  return signerAddr !== airnode;
};

export const checkSignedDataIntegrity = (signedData: SignedData) => {
  const { airnode, templateId, timestamp, encodedValue } = signedData;

  if (parseInt(timestamp) * 1_000 > Date.now()) {
    logger.warn(
      `Refusing to store sample as timestamp is in the future: (Airnode ${airnode}) (Template ID ${templateId}) (Received timestamp ${new Date(
        parseInt(timestamp) * 1_000
      ).toLocaleDateString()} vs now ${new Date().toLocaleDateString()}), ${
        BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8
      }`
    );
    return false;
  }

  if (checkMessage(signedData)) {
    logger.warn(
      `Refusing to store sample as signature does not match: (Airnode ${airnode}) (Template ID ${templateId}) (Received timestamp ${new Date(
        parseInt(timestamp) * 1_000
      ).toLocaleDateString()} vs now ${new Date().toLocaleDateString()}), ${
        BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8
      }`
    );
    return false;
  }

  return true;
};

const setStoreDataPoint = async (signedData: SignedData) => {
  const { airnode, templateId, signature, timestamp, encodedValue } = signedData;

  if (!checkSignedDataIntegrity(signedData)) {
    logger.warn(`Signed data received from signed data API has a signature mismatch.`);
    logger.warn(JSON.stringify({ airnode, templateId, signature, timestamp, encodedValue }, null, 2));
    return;
  }

  if (!signedApiStore[airnode]) {
    signedApiStore[airnode] = {};
  }

  const existingValue = signedApiStore[airnode]![templateId];
  if (existingValue && existingValue.timestamp >= timestamp) {
    logger.debug('Skipping store update. The existing store value is fresher.');
    return;
  }

  logger.debug(
    `Storing sample for (Airnode ${airnode}) (Template ID ${templateId}) (Timestamp ${new Date(
      parseInt(timestamp) * 1_000
    ).toISOString()}), ${BigNumber.from(encodedValue).div(10e10).toNumber() / 10e8}`
  );

  signedApiStore[airnode]![templateId] = { signature, timestamp, encodedValue };
};

const getStoreDataPoint = async (airnode: AirnodeAddress, templateId: TemplateId) =>
  (signedApiStore[airnode] ?? {})[templateId];

const clear = async () => {
  signedApiStore = {};
};

const prune = async () => {
  Object.keys(signedApiStore).forEach((airnodeAddress) => {
    Object.keys(signedApiStore[airnodeAddress] ?? {}).forEach((templateId) => {
      const { timestamp } = (signedApiStore[airnodeAddress] ?? {})[templateId] ?? {};

      if (timestamp && Date.now() - parseInt(timestamp) > 24 * 60 * 60) {
        // timestamps are in s, not ms
        // the datapoint is more than 24 hours old
        delete (signedApiStore[airnodeAddress] ?? {})[templateId];
      }
    });
  });
};

const init = async () => {
  pruner = setInterval(prune, 300_000);
};

const shutdown = async () => {
  clearInterval(pruner);
};

export const localDataStore: DataStore = {
  getStoreDataPoint,
  setStoreDataPoint,
  init,
  shutdown,
  prune,
  clear,
};
