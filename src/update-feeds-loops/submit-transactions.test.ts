import type { Api3ServerV1 } from '@api3/airnode-protocol-v1';
import { ethers } from 'ethers';

import { generateMockApi3ServerV1 } from '../../test/fixtures/mock-contract';
import { allowPartial } from '../../test/utils';
import * as gasPriceModule from '../gas-price';
import { logger } from '../logger';
import * as stateModule from '../state';
import * as utilsModule from '../utils';

import type { UpdatableDataFeed } from './get-updatable-feeds';
import * as submitTransactionsModule from './submit-transactions';

describe(submitTransactionsModule.estimateMulticallGasLimit.name, () => {
  it('estimates the gas limit for a multicall', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockResolvedValueOnce(ethers.BigNumber.from(500_000));

    const gasLimit = await submitTransactionsModule.estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
      undefined
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(550_000)); // Note that the gas limit is increased by 10%.
  });

  it('uses fallback gas limit when dummy data estimation fails', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(new Error('some-error'));

    const gasLimit = await submitTransactionsModule.estimateMulticallGasLimit(
      mockApi3ServerV1 as unknown as Api3ServerV1,
      ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
      2_000_000
    );

    expect(gasLimit).toStrictEqual(ethers.BigNumber.from(2_000_000));
  });

  it('throws an error if no fallback is provided', async () => {
    const mockApi3ServerV1 = generateMockApi3ServerV1();
    mockApi3ServerV1.estimateGas.multicall.mockRejectedValue(new Error('some-error'));

    await expect(async () =>
      submitTransactionsModule.estimateMulticallGasLimit(
        mockApi3ServerV1 as unknown as Api3ServerV1,
        ['0xBeaconId1Calldata', '0xBeaconId2Calldata', '0xBeaconSetCalldata'],
        undefined
      )
    ).rejects.toStrictEqual(new Error('Unable to estimate gas limit'));
  });
});

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
              airnode: 'airnode',
              signature: 'some-signature',
              templateId: 'template',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
        ],
        dataFeedInfo: {
          decodedDataFeed: {
            beacons: [
              {
                beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
              },
            ],
          },
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(1);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledWith('updateBeaconWithSignedData', [
      'airnode',
      'template',
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
              airnode: 'airnode-1',
              signature: 'some-signature-1',
              templateId: 'template-1',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000190',
              timestamp: '200',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc7',
            signedData: {
              airnode: 'airnode-2',
              signature: 'some-signature-2',
              templateId: 'template-2',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000350',
              timestamp: '300',
            },
          },
          {
            beaconId: '0xf5c140bcb4814dfec311d38f6293e86c02d32ba1b7da027fe5b5202cae35dbc8',
            signedData: {
              airnode: 'airnode-3',
              signature: 'some-signature-3',
              templateId: 'template-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          decodedDataFeed: {
            beacons: [
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
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(4);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      'airnode-1',
      'template-1',
      '200',
      '0x0000000000000000000000000000000000000000000000000000000000000190',
      'some-signature-1',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(2, 'updateBeaconWithSignedData', [
      'airnode-2',
      'template-2',
      '300',
      '0x0000000000000000000000000000000000000000000000000000000000000350',
      'some-signature-2',
    ]);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(3, 'updateBeaconWithSignedData', [
      'airnode-3',
      'template-3',
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
              airnode: 'airnode-3',
              signature: 'some-signature-3',
              templateId: 'template-3',
              encodedValue: '0x0000000000000000000000000000000000000000000000000000000000000270',
              timestamp: '400',
            },
          },
        ],
        dataFeedInfo: {
          decodedDataFeed: {
            beacons: [
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
        },
      })
    );

    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenCalledTimes(2);
    expect(api3ServerV1.interface.encodeFunctionData).toHaveBeenNthCalledWith(1, 'updateBeaconWithSignedData', [
      'airnode-3',
      'template-3',
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
});

describe(submitTransactionsModule.getDerivedSponsorWallet.name, () => {
  it('returns the derived sponsor wallet for a dAPI', () => {
    const dapiName = utilsModule.encodeDapiName('ETH/USD');
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        derivedSponsorWallets: {
          [dapiName]: '0x034e238bdc2622122e7b2191ee5be5df38597b6f58e45b25c6d32cae3110ebfa',
        },
      })
    );
    jest.spyOn(utilsModule, 'deriveSponsorWallet');

    const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet('some-mnemonic', dapiName);

    expect(utilsModule.deriveSponsorWallet).toHaveBeenCalledTimes(0);
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
    jest.spyOn(utilsModule, 'deriveSponsorWallet');

    const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet(
      'diamond result history offer forest diagram crop armed stumble orchard stage glance',
      dapiName
    );

    expect(utilsModule.deriveSponsorWallet).toHaveBeenCalledTimes(1);
    expect(sponsorWallet.privateKey).toBe('0xd4cc2592775d876d6af59163bb7894272d84f538439e3c53af3bebdc0668b49d');
  });

  it('derives the sponsor wallet for a data feed ID if it does not exist', () => {
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        derivedSponsorWallets: {},
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();
    jest.spyOn(utilsModule, 'deriveSponsorWallet');

    const sponsorWallet = submitTransactionsModule.getDerivedSponsorWallet(
      'diamond result history offer forest diagram crop armed stumble orchard stage glance',
      '0x173ec7594911a9d584d577bc8e8b9bb546018667d820a67685df49201a11ae9b'
    );

    expect(utilsModule.deriveSponsorWallet).toHaveBeenCalledTimes(1);
    expect(sponsorWallet.privateKey).toBe('0x1a193892271d2a8c1e39b9d78281a9e7f8c080965dc3ed744eac7746c47b700e');
  });
});

describe(submitTransactionsModule.submitTransactions.name, () => {
  it('updates all feeds', async () => {
    jest.spyOn(submitTransactionsModule, 'submitTransaction').mockImplementation();

    await submitTransactionsModule.submitTransactions(
      '31337',
      'evm-local',
      new ethers.providers.StaticJsonRpcProvider(),
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
});

describe(submitTransactionsModule.submitTransaction.name, () => {
  const dapiName = utilsModule.encodeDapiName('ETH/USD');

  it('updates a dAPI', async () => {
    jest.spyOn(submitTransactionsModule, 'createUpdateFeedCalldatas').mockReturnValue(['calldata1', 'calldata2']);
    jest.spyOn(logger, 'debug');
    jest.spyOn(logger, 'info');
    jest.spyOn(submitTransactionsModule, 'estimateMulticallGasLimit').mockResolvedValue(ethers.BigNumber.from(500_000));
    jest.spyOn(gasPriceModule, 'getRecommendedGasPrice').mockResolvedValue(ethers.BigNumber.from(100_000_000));
    jest.spyOn(submitTransactionsModule, 'hasSponsorPendingTransaction').mockReturnValue(false);
    const api3ServerV1 = generateMockApi3ServerV1();
    jest.spyOn(api3ServerV1, 'connect').mockReturnValue(api3ServerV1);
    jest.spyOn(api3ServerV1, 'tryMulticall');
    jest.spyOn(stateModule, 'getState').mockReturnValue(
      allowPartial<stateModule.State>({
        config: {
          chains: {
            '31337': {
              dataFeedUpdateInterval: 60,
              fallbackGasLimit: undefined,
            },
          },
          sponsorWalletMnemonic: 'diamond result history offer forest diagram crop armed stumble orchard stage glance',
        },
      })
    );
    jest.spyOn(stateModule, 'updateState').mockImplementation();

    await submitTransactionsModule.submitTransaction(
      '31337',
      'evm-local',
      new ethers.providers.StaticJsonRpcProvider(),
      api3ServerV1 as unknown as Api3ServerV1,
      allowPartial<UpdatableDataFeed>({
        dataFeedInfo: {
          dapiName,
          decodedDataFeed: {
            dataFeedId: '0xBeaconSetId',
          },
        },
      }),
      1
    );

    // Verify that the data feed was updated successfully.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Successfully updated data feed.');

    // Verify the flow of the update process via the debug logs. Note, that some debug log calls are not here because
    // many functions are mocked.
    expect(logger.debug).toHaveBeenCalledTimes(7);
    expect(logger.debug).toHaveBeenNthCalledWith(1, 'Creating calldatas.');
    expect(logger.debug).toHaveBeenNthCalledWith(2, 'Estimating gas limit.');
    expect(logger.debug).toHaveBeenNthCalledWith(3, 'Getting derived sponsor wallet.');
    expect(logger.debug).toHaveBeenNthCalledWith(4, 'Derived new sponsor wallet.', {
      sponsorWalletAddress: '0xA772F7b103BBecA3Bb6C74Be41fCc2c192C8146c',
    });
    expect(logger.debug).toHaveBeenNthCalledWith(5, 'Getting gas price.');
    expect(logger.debug).toHaveBeenNthCalledWith(6, 'Setting timestamp of the original update transaction.');
    expect(logger.debug).toHaveBeenNthCalledWith(7, 'Updating data feed.', {
      gasLimit: '500000',
      gasPrice: '100000000',
    });
  });
});
