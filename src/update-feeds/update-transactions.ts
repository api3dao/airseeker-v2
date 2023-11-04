import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';

import { AIRSEEKER_PROTOCOL_ID } from '../constants';
import { logger } from '../logger';
import { getState } from '../state';
import type { SignedData } from '../types';

import type { ReadDapiWithIndexResponse } from './dapi-data-registry';

export interface UpdateableBeacon {
  beaconId: string;
  signedData: SignedData;
}

export interface UpdateableDapi {
  dapiInfo: ReadDapiWithIndexResponse;
  updateableBeacons: UpdateableBeacon[];
}

export const updateFeeds = async (
  api3ServerV1: Api3ServerV1,
  gasPrice: ethers.BigNumber,
  updateableDapis: UpdateableDapi[]
) => {
  const state = getState();
  const {
    config: { sponsorWalletMnemonic },
  } = state;

  // Update all of the dAPIs in parallel.
  await Promise.all(
    updateableDapis.map(async (dapi) => {
      const { dapiInfo, updateableBeacons } = dapi;
      // TODO: dapiInfo.dataFeed as of now is the encoded data feed information.
      const { dapiName, dataFeed: dataFeedId } = dapiInfo;

      await logger.runWithContext({ dapiName, dataFeedId }, async () => {
        const goUpdate = await go(async () => {
          logger.debug('Updating dAPI');

          // Create calldata for all beacons of the particular data feed the dAPI points to.
          const beaconUpdateCalls = updateableBeacons.map((beacon) => {
            const { signedData } = beacon;

            return api3ServerV1.interface.encodeFunctionData('updateBeaconWithSignedData', [
              signedData.airnode,
              signedData.templateId,
              signedData.timestamp,
              signedData.encodedValue,
              signedData.signature,
            ]);
          });

          // If there are multiple beacons in the data feed it's a beacons set which we need to update as well.
          const dataFeedUpdateCalldatas =
            beaconUpdateCalls.length > 1
              ? [
                  ...beaconUpdateCalls,
                  api3ServerV1.interface.encodeFunctionData('updateBeaconSetWithBeacons', [
                    updateableBeacons.map(({ beaconId }) => beaconId),
                  ]),
                ]
              : beaconUpdateCalls;

          logger.debug('Estimating gas limit');
          const gasLimit = await estimateMulticallGasLimit(api3ServerV1, dataFeedUpdateCalldatas);

          logger.debug('Deriving sponsor wallet');
          // TODO: These wallets could be persisted as a performance optimization.
          const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName);

          logger.debug('Updating dAPI', { gasPrice, gasLimit });
          await api3ServerV1
            // When we add the sponsor wallet (signer) without connecting it to the provider, the provider of the
            // contract will be set to "null". We need to connect the sponsor wallet to the provider of the contract.
            .connect(sponsorWallet.connect(api3ServerV1.provider))
            .tryMulticall(dataFeedUpdateCalldatas, { gasPrice, gasLimit });
          logger.debug('Successfully updated dAPI');
        });

        if (!goUpdate.success) {
          logger.error(`Failed to update a dAPI`, goUpdate.error);
        }
      });
    })
  );
};

// TODO: Test for all of these functions below.
const estimateMulticallGasLimit = async (api3ServerV1: Api3ServerV1, calldatas: string[]) => {
  const goEstimateGas = await go(async () => api3ServerV1.estimateGas.multicall(calldatas));
  if (goEstimateGas.success) {
    // Adding a extra 10% because multicall consumes less gas than tryMulticall
    return goEstimateGas.data.mul(ethers.BigNumber.from(Math.round(1.1 * 100))).div(ethers.BigNumber.from(100));
  }
  logger.warn(`Unable to estimate gas for multicall`, goEstimateGas.error);

  const goEstimateDummyBeaconUpdateGas = await go(async () => {
    const { dummyAirnode, dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData, dummyBeaconSignature } =
      await createDummyBeaconUpdateData();
    return api3ServerV1.estimateGas.updateBeaconWithSignedData(
      dummyAirnode.address,
      dummyBeaconTemplateId,
      dummyBeaconTimestamp,
      dummyBeaconData,
      dummyBeaconSignature
    );
  });
  if (goEstimateDummyBeaconUpdateGas.success) {
    // This logic is taken from Airseeker v1. One of the calldatas will actually be the beacon set update so this logic
    // is not 100% accurate. The beacon set update consumles less gas so this is a safe estimate.
    return goEstimateDummyBeaconUpdateGas.data.mul(calldatas.length);
  }

  return ethers.BigNumber.from(2_000_000);
};

export const deriveSponsorWallet = (sponsorWalletMnemonic: string, dapiName: string) => {
  // Take first 20 bytes of dapiName as sponsor address together with the "0x" prefix.
  const sponsorAddress = ethers.utils.getAddress(dapiName.slice(0, 42));
  const sponsorWallet = ethers.Wallet.fromMnemonic(
    sponsorWalletMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress)}`
  );
  logger.debug('Derived sponsor wallet', { sponsorAddress, sponsorWalletAddress: sponsorWallet.address });

  return sponsorWallet;
};

function deriveWalletPathFromSponsorAddress(sponsorAddress: string) {
  const sponsorAddressBN = ethers.BigNumber.from(sponsorAddress);
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${AIRSEEKER_PROTOCOL_ID}/${paths.join('/')}`;
}

export const createDummyBeaconUpdateData = async (dummyAirnode: ethers.Wallet = ethers.Wallet.createRandom()) => {
  const dummyBeaconTemplateId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const dummyBeaconTimestamp = Math.floor(Date.now() / 1000);
  const randomBytes = ethers.utils.randomBytes(Math.floor(Math.random() * 27) + 1);
  const dummyBeaconData = ethers.utils.defaultAbiCoder.encode(
    ['int224'],
    // Any random number that fits into an int224
    [ethers.BigNumber.from(randomBytes)]
  );
  const dummyBeaconSignature = await dummyAirnode.signMessage(
    ethers.utils.arrayify(
      ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256', 'bytes'],
        [dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData]
      )
    )
  );
  return { dummyAirnode, dummyBeaconTemplateId, dummyBeaconTimestamp, dummyBeaconData, dummyBeaconSignature };
};
