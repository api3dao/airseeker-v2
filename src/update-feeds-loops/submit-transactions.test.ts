import type { Api3ServerV1 } from '@api3/contracts';
import { ethers } from 'ethers';

import { generateMockApi3ServerV1 } from '../../test/fixtures/mock-contract';
import { allowPartial } from '../../test/utils';
import * as gasPriceModule from '../gas-price';
import { logger } from '../logger';
import * as stateModule from '../state';
import * as utilsModule from '../utils';

import * as gasEstimationModule from './gas-estimation';
import type { UpdatableDataFeed } from './get-updatable-feeds';
import * as submitTransactionsModule from './submit-transactions';

describe(submitTransactionsModule.createUpdateFeedCalldatas.name, () => {
  it('creates beacon update calldata', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode',
              signature: 'some-signature',
              templateId: '0xTemplate',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(1);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledWith('updateBeaconWithSignedData', [
      '0xAirnode',
      '0xTemplate',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      'some-signature',
    ]);
  });

  it('creates beacon set update calldata with all beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            signedData: {
              airnode: '0xAirnode-1',
              signature: 'some-signature-1',
              templateId: '0xTemplate-1',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            signedData: {
              airnode: '0xAirnode-2',
              signature: 'some-signature-2',
              templateId: '0xTemplate-2',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000350',
              timestamp: '300',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode-3',
              signature: 'some-signature-3',
              templateId: '0xTemplate-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
        shouldUpdateBeaconSet: true,
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(4);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      '0xAirnode-1',
      '0xTemplate-1',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      'some-signature-1',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconWithSignedData', [
      '0xAirnode-2',
      '0xTemplate-2',
      '300',
      '0x0000000000000000000000000000000000000000000000000000000000000350',
      'some-signature-2',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(3, 'updateBeaconWithSignedData', [
      '0xAirnode-3',
      '0xTemplate-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      'some-signature-3',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(4, 'updateBeaconSetWithBeacons', [
      [
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
      ],
    ]);
  });

  it('updates beacon set update calldata with some beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode-3',
              signature: 'some-signature-3',
              templateId: '0xTemplate-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
        shouldUpdateBeaconSet: true,
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(2);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      '0xAirnode-3',
      '0xTemplate-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      'some-signature-3',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconSetWithBeacons', [
      [
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
        '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
      ],
    ]);
  });

  it('only creates calldata for some beacons updatable', () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.interface, 'encodeFunctionData');

    submitTransactionsModule.createUpdateFeedCalldatas(
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: '0xAirnode-3',
              signature: 'some-signature-3',
              templateId: '0xTemplate-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          beaconsWithData: [
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc6',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            },
            {
              beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            },
          ],
        },
        shouldUpdateBeaconSet: false,
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(1);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledWith('updateBeaconWithSignedData', [
      '0xAirnode-3',
      '0xTemplate-3',
      '400',
      '0x0000000000000000000000000000000000000000000000000000000000000270',
      'some-signature-3',
    ]);
  });
});

describe(submitTransactionsModule.getDerivedSponsorWallet.name, () => {
  describe('managed feeds', () => {
    it('returns the derived sponsor wallet for a dAPI', () => {
      const dapiName = utilsModule.encodeDapiName('ETH/USD');
      const sponsorAddress = utilsModule.deriveSponsorAddressForManagedFeed(dapiName);
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {
            [sponsorAddress]: '0x034e238bdc2622122e7b2191ee5be5df38597b6f58e45b25c6d32cae3110ebfa',
          },
        })
      );
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet('some-mnemonic', {
        type: 'managed',
        dapiNameOrDataFeedId: dapiName,
        updateParameters: 'does-not-matter',
      });

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(0);
      expect(sponsorWallet.privateKey).toBe('0x034e238bdc2622122e7b2191ee5be5df38597b6f58e45b25c6d32cae3110ebfa');
    });

    it('derives the sponsor wallet for a dAPI if it does not exist', () => {
      const dapiName = utilsModule.encodeDapiName('ETH/USD');
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {},
        })
      );
      jest.spyOn(stateModule, 'updateState').mockImplementation();
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet(
        'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        {
          type: 'managed',
          dapiNameOrDataFeedId: dapiName,
          updateParameters: 'does-not-matter',
        }
      );

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(1);
      expect(sponsorWallet.privateKey).toBe('0xd4cc2592775d876d6af59163bb7894272d84f538439e3c53af3bebdc0668b49d');
    });

    it('derives the sponsor wallet for a data feed ID if it does not exist', () => {
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {},
        })
      );
      jest.spyOn(stateModule, 'updateState').mockImplementation();
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet(
        'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        {
          type: 'managed',
          dapiNameOrDataFeedId: '0x173ec7594911a9d584d577bc8e8b9bb546018667d820a67685df49201a11ae9b',
          updateParameters: 'does-not-matter',
        }
      );

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(1);
      expect(sponsorWallet.privateKey).toBe('0x1a193892271d2a8c1e39b9d78281a9e7f8c080965dc3ed744eac7746c47b700e');
    });
  });

  describe('self-funded feeds', () => {
    it('derives the sponsor wallet for a dAPI if it does not exist', () => {
      const dapiName = utilsModule.encodeDapiName('ETH/USD');
      const updateParameters =
        '0x0000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000000000064';
      jest.spyOn(stateModule, 'getState').mockReturnValue(
        allowPartial<stateModule.State>({
          derivedSponsorWallets: {},
        })
      );
      jest.spyOn(stateModule, 'updateState').mockImplementation();
      jest.spyOn(utilsModule, 'deriveSponsorWalletFromSponsorAddress');

      const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet(
        'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        {
          type: 'self-funded',
          dapiNameOrDataFeedId: dapiName,
          updateParameters,
        }
      );

      expect(utilsModule.deriveSponsorWalletFromSponsorAddress).toHaveBeenCalledTimes(1);
      expect(sponsorWallet.privateKey).toBe('0x858cd2fbfc60014023911f94190ee4f4bb2d5acf8910a4c0c47596db5717ce5a');
    });
  });
});

describe(submitTransactionsModule.submitTransactions.name, () => {
  it('submits a transaction for each feed to update in the batch', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: { walletDerivationScheme: { type: 'managed' } },
      })
    );
    jest.spyOn(submitTransactionsModule, 'submitTransaction').mockImplementation();

    await submitTransactionsModule.submitTransactions(
      '31337',
      'evm-local',
      new ethers.JsonRpcProvider(),
      generateMockApi3ServerV1() as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('ETH/USD') },
        }),
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('BTC/USD') },
        }),
      ],
      123_456
    );

    expect(submitTransactionsModule.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it('submits a single transaction for updating all feeds in the batch', async () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          walletDerivationScheme: { type: 'fixed', sponsorAddress: '0x0000000000000000000000000000000000000001' },
        },
      })
    );
    jest.spyOn(submitTransactionsModule, 'submitBatchTransaction').mockImplementation();

    await submitTransactionsModule.submitTransactions(
      '31337',
      'evm-local',
      new ethers.JsonRpcProvider(),
      generateMockApi3ServerV1() as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('ETH/USD') },
        }),
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: { dapiName: utilsModule.encodeDapiName('BTC/USD') },
        }),
      ],
      123_456
    );

    expect(submitTransactionsModule.submitBatchTransaction).toHaveBeenCalledTimes(1);
  });
});

describe(submitTransactionsModule.submitBatchTransaction.name, () => {
  const dapiNames = [utilsModule.encodeDapiName('BTC/USD'), utilsModule.encodeDapiName('ETH/USD')];

  it('updates all dAPIs', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'info');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          walletDerivationScheme: { type: 'fixed', sponsorAddress: '0x0000000000000000000000000000000000000001' },
          sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockResolvedValue(0),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitBatchTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      dapiNames.map((dapiName) =>
        allowPartial<UpdatableDataFeed>({
          updatableBeacons: [
            {
              beaconId: '0xBeaconId1',
              signedData: {
                airnode: '0xAirnode1',
                templateId: '0xTemplateId1',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
          dataFeedInfo: {
            dapiName,
            dataFeedId: '0xBeaconSetId',
            beaconsWithData: [
              {
                beaconId: '0xBeaconId1',
                airnodeAddress: '0xAirnode1',
                templateId: '0xTemplateId1',
              },
              {
                beaconId: '0xBeaconId2',
                airnodeAddress: '0xAirnode2',
                templateId: '0xTemplateId2',
              },
            ],
          },
        })
      ),
      123_456
    );

    // Verify that the data feed was updated successfully.
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', {
      sponsorWalletAddress: '0xFaFF9C2E67716d2209552f46Fa9829D46830aCcB',
      gasLimit: '500000',
      gasPrice: '100000000',
      nonce: 0,
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });

    // Verify the flow of the update process via the debug logs. Note, that some debug log calls are not here because
    // many functions are mocked.
    expect(logger.debug).toHaveBeenCalledTimes(6);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Getting derived sponsor wallet.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Derived new sponsor wallet.', {
      sponsorAddress: expect.any(String),
      sponsorWalletAddress: '0xFaFF9C2E67716d2209552f46Fa9829D46830aCcB',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting nonce.');
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Getting recommended gas price.');
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Creating calldatas.');
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Estimating multicall update gas limit.');
  });

  it('logs an error when getting nonce fails', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'warn');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          walletDerivationScheme: { type: 'managed' },
          sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockRejectedValue(new Error('some-error')),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          dapiName: dapiNames[1]!,
          dataFeedId: '0xBeaconSetId',
        },
      }),
      123_456
    );

    // Verify that the data feed was not updated.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Failed to get nonce.', new Error('some-error'));
  });
});

describe(submitTransactionsModule.submitTransaction.name, () => {
  const dapiName = utilsModule.encodeDapiName('ETH/USD');

  it('updates a dAPI', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'info');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          walletDerivationScheme: { type: 'managed' },
          sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockResolvedValue(0),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        updatableBeacons: [
          {
            beaconId: '0xBeaconId1',
            signedData: {
              airnode: '0xAirnode1',
              templateId: '0xTemplateId1',
              timestamp: '1629811000',
              encodedValue: '0xEncodedValue',
              signature: '0xSignature',
            },
          },
        ],
        dataFeedInfo: {
          dapiName,
          dataFeedId: '0xBeaconSetId',
          beaconsWithData: [
            {
              beaconId: '0xBeaconId1',
              airnodeAddress: '0xAirnode1',
              templateId: '0xTemplateId1',
            },
            {
              beaconId: '0xBeaconId2',
              airnodeAddress: '0xAirnode2',
              templateId: '0xTemplateId2',
            },
          ],
        },
      }),
      123_456
    );

    // Verify that the data feed was updated successfully.
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', {
      gasLimit: '500000',
      gasPrice: '100000000',
      nonce: 0,
      sponsorWalletAddress: '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c',
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });

    // Verify the flow of the update process via the debug logs. Note, that some debug log calls are not here because
    // many functions are mocked.
    expect(logger.debug).toHaveBeenCalledTimes(6);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Getting derived sponsor wallet.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Derived new sponsor wallet.', {
      sponsorAddress: expect.any(String),
      sponsorWalletAddress: '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting nonce.');
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Getting recommended gas price.');
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Creating calldatas.');
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Estimating multicall update gas limit.');
  });

  it('logs an error when getting nonce fails', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'warn');
    jest.spyOn(gasEstimationModule, 'estimateMulticallGasLimit').mockResolvedValue(BigInt(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockReturnValue(BigInt(100_000_000));
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          walletDerivationScheme: { type: 'managed' },
          sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    const provider = {
      getTransactionCount: jest.fn().mockRejectedValue(new Error('some-error')),
    } as unknown as ethers.JsonRpcProvider;

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      provider,
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          dapiName,
          dataFeedId: '0xBeaconSetId',
        },
      }),
      123_456
    );

    // Verify that the data feed was not updated.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Failed to get nonce.', new Error('some-error'));
  });
});

describe(submitTransactionsModule.submitUpdate.name, () => {
  it('submits a single beacon update', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.updateBeaconWithSignedData, 'estimateGas').mockReturnValue(150_000n);
    jest.spyOn(api3ServerV1.updateBeaconWithSignedData, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(logger, 'info');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId',
                airnodeAddress: '0xAirnode',
                templateId: '0xTemplateId',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId',
              signedData: {
                airnode: '0xAirnode',
                templateId: '0xTemplateId',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating single beacon.', {
      sponsorWalletAddress: '0xD8Ba840Cae5c24e5Dc148355Ea3cde3CFB12f8eF',
      gasPrice: '100000000',
      gasLimit: '150000',
      nonce: 11,
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });
  });

  it('submits a beacon set update', async () => {
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1.multicall, 'estimateGas').mockReturnValue(150_000n);
    jest.spyOn(api3ServerV1.tryMulticall, 'send').mockReturnValue({ hash: '0xTransactionHash' });
    jest.spyOn(logger, 'info');
    const sponsorWallet = new ethers.Wallet('a0d8c3f6643d494b31914e7ec896215562aa358bf7ff68218afb53dfedd4167f');

    const result = await submitTransactionsModule.submitUpdate(
      api3ServerV1 as unknown as Api3ServerV1,
      [
        allowPartial<UpdatableDataFeed>({
          dataFeedInfo: {
            beaconsWithData: [
              {
                beaconId: '0xBeaconId1',
                airnodeAddress: '0xAirnode1',
                templateId: '0xTemplateId1',
              },
              {
                beaconId: '0xBeaconId2',
                airnodeAddress: '0xAirnode2',
                templateId: '0xTemplateId2',
              },
            ],
          },
          updatableBeacons: [
            {
              beaconId: '0xBeaconId1',
              signedData: {
                airnode: '0xAirnode1',
                templateId: '0xTemplateId1',
                timestamp: '1629811000',
                encodedValue: '0xEncodedValue',
                signature: '0xSignature',
              },
            },
          ],
        }),
      ],
      undefined,
      sponsorWallet,
      BigInt(100_000_000),
      11
    );

    expect(result).toStrictEqual({ hash: '0xTransactionHash' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Updating data feed(s).', {
      sponsorWalletAddress: '0xD8Ba840Cae5c24e5Dc148355Ea3cde3CFB12f8eF',
      gasPrice: '100000000',
      gasLimit: '165000',
      nonce: 11,
    });
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Successfully submitted the update transaction.', {
      txHash: '0xTransactionHash',
    });
  });
});
