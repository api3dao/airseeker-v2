import { fetchAndStoreGasPrice, initializeGasState } from '../../src/gas-price';
import { logger } from '../../src/logger';
import * as stateModule from '../../src/state';
import { runUpdateFeeds } from '../../src/update-feeds-loops';
import {
  type DecodedActiveDataFeedResponse,
  createBeaconsWithData,
  decodeDataFeedDetails,
  decodeUpdateParameters,
} from '../../src/update-feeds-loops/contracts';
import { initializePendingTransactionsInfo } from '../../src/update-feeds-loops/pending-transaction-info';
import { submitTransactions } from '../../src/update-feeds-loops/submit-transactions';
import { decodeDapiName } from '../../src/utils';
import { initializeState } from '../fixtures/mock-config';
import { deployAndUpdate } from '../setup/contract';
import { generateSignedData } from '../utils';

const chainId = '31337';
const providerName = 'localhost';

it('reads blockchain data', async () => {
  const { config } = await deployAndUpdate();
  const [chainId, chain] = Object.entries(config.chains)[0]!;
  const providerName = Object.keys(chain.providers)[0]!;
  jest.spyOn(logger, 'info').mockImplementation();

  initializeState(config);
  initializeGasState(chainId, providerName);
  initializePendingTransactionsInfo(chainId, providerName);

  await runUpdateFeeds(providerName, chain, chainId);

  expect(logger.info).toHaveBeenCalledWith('Processing batch of active data feeds.', expect.anything());
});

it('updates blockchain data', async () => {
  const {
    config,
    api3ServerV1,
    airseekerRegistry,
    krakenBtcBeacon,
    binanceBtcBeacon,
    krakenAirnodeWallet,
    binanceAirnodeWallet,
    airseekerWallet,
    provider,
  } = await deployAndUpdate();
  initializeState(config);
  stateModule.updateState((draft) => {
    draft.config.sponsorWalletMnemonic = airseekerWallet.mnemonic!.phrase;
  });
  initializeGasState(chainId, providerName);
  initializePendingTransactionsInfo(chainId, providerName);
  const {
    dataFeedId,
    dapiName,
    dataFeedDetails,
    dataFeedValue,
    dataFeedTimestamp,
    updateParameters,
    signedApiUrls,
    beaconValues,
    beaconTimestamps,
  } = await airseekerRegistry.activeDataFeed(0);

  const beacons = decodeDataFeedDetails(dataFeedDetails)!;
  const activeBtcDataFeed = {
    dapiName,
    decodedDapiName: decodeDapiName(dapiName),
    updateParameters,
    decodedUpdateParameters: decodeUpdateParameters(updateParameters),
    dataFeedId,
    dataFeedValue,
    dataFeedTimestamp,
    signedApiUrls,
    beaconsWithData: createBeaconsWithData(beacons, beaconValues, beaconTimestamps),
  } as DecodedActiveDataFeedResponse;

  const currentBlock = await provider.getBlock('latest');
  const currentBlockTimestamp = currentBlock!.timestamp;
  const binanceBtcSignedData = await generateSignedData(
    binanceAirnodeWallet,
    binanceBtcBeacon.templateId,
    (currentBlockTimestamp + 1).toString()
  );
  const krakenBtcSignedData = await generateSignedData(
    krakenAirnodeWallet,
    krakenBtcBeacon.templateId,
    (currentBlockTimestamp + 2).toString()
  );
  jest.spyOn(logger, 'debug');
  jest.spyOn(logger, 'info');
  jest.spyOn(logger, 'warn');
  const blockNumber = await provider.getBlockNumber();
  await fetchAndStoreGasPrice(chainId, providerName, provider);

  await submitTransactions(
    chainId,
    providerName,
    provider,
    api3ServerV1,
    [
      {
        dataFeedInfo: activeBtcDataFeed,
        updatableBeacons: [
          {
            beaconId: binanceBtcBeacon.beaconId,
            signedData: binanceBtcSignedData,
          },
          {
            beaconId: krakenBtcBeacon.beaconId,
            signedData: krakenBtcSignedData,
          },
        ],
        shouldUpdateBeaconSet: true,
      },
    ],
    blockNumber
  );

  expect(logger.debug).toHaveBeenCalledTimes(7);
  expect(logger.debug).toHaveBeenNthCalledWith(1, 'Fetching gas price and saving it to the state.');
  expect(logger.debug).toHaveBeenNthCalledWith(2, 'Getting derived sponsor wallet.');
  expect(logger.debug).toHaveBeenNthCalledWith(3, 'Derived new sponsor wallet.', expect.anything());
  expect(logger.debug).toHaveBeenNthCalledWith(4, 'Getting nonce.');
  expect(logger.debug).toHaveBeenNthCalledWith(5, 'Getting recommended gas price.');
  expect(logger.debug).toHaveBeenNthCalledWith(6, 'Creating calldatas.');
  expect(logger.debug).toHaveBeenNthCalledWith(7, 'Estimating multicall update gas limit.');
  expect(logger.info).toHaveBeenCalledTimes(2);
  expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', expect.anything());
  expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', expect.anything());
  expect(logger.warn).toHaveBeenCalledTimes(0);
});
