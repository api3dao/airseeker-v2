import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { interpolateSecretsIntoConfig } from '@api3/commons';
import dotenv from 'dotenv';
import { ZodError } from 'zod';

import {
  chainsSchema,
  configSchema,
  deviationThresholdCoefficientSchema,
  asyncBeaconUpdatedeviationThresholdFactorSchema,
  walletDerivationSchemeSchema,
} from './schema';

const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 900,
  sanitizationPercentile: 80,
  scalingWindow: 120,
  maxScalingMultiplier: 2,
  sanitizationMultiplier: 3,
};

test('validates example config', () => {
  const exampleConfig = JSON.parse(readFileSync(join(__dirname, '../../config/airseeker.example.json'), 'utf8'));

  // The mnemonic is not interpolated (and thus invalid).
  expect(() => configSchema.parse(exampleConfig)).toThrow(
    new ZodError([
      {
        validation: 'url',
        code: 'invalid_string',
        message: 'Invalid url',
        path: ['chains', '31337', 'providers', 'hardhat', 'url'],
      },
      {
        code: 'custom',
        message: 'Invalid mnemonic',
        path: ['sponsorWalletMnemonic'],
      },
    ])
  );

  const exampleSecrets = dotenv.parse(readFileSync(join(__dirname, '../../config/secrets.example.env'), 'utf8'));
  expect(configSchema.parse(interpolateSecretsIntoConfig(exampleConfig, exampleSecrets))).toStrictEqual(
    expect.any(Object)
  );
});

describe('chains schema', () => {
  it('uses the specified contract address', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    const parsed = chainsSchema.parse(chains);

    expect(parsed['31337']!.contracts).toStrictEqual({
      Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    });
  });

  it('uses the contract address from airnode-protocol-v1', () => {
    const chains = {
      '1': {
        providers: {
          mainnet: {
            url: 'http://mainnet-url.com',
          },
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
      },
    };

    const parsed = chainsSchema.parse(chains);

    expect(parsed['1']!.contracts).toStrictEqual({
      Api3ServerV1: '0x709944a48cAf83535e43471680fDA4905FB3920a',
      AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    });
  });

  it('throws if the contract address cannot be loaded', () => {
    const chains = {
      '31337': {
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        contracts: {
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid contract addresses',
          path: ['31337', 'contracts', 'Api3ServerV1'],
        },
      ])
    );
  });

  it('throws if the contract address is invalid', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xInvalid',
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        providers: {
          hardhat: {
            url: 'http://localhost:8545',
          },
        },
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid EVM address',
          path: ['31337', 'contracts', 'Api3ServerV1'],
        },
      ])
    );
  });

  it('requires at least 1 chain', () => {
    const chains = {};

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Missing chains. At least one chain is required.',
          path: ['chains'],
        },
      ])
    );
  });

  it('requires at least 1 provider', () => {
    const chains = {
      '31337': {
        contracts: {
          Api3ServerV1: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          AirseekerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        },
        providers: {},
        gasSettings,
        dataFeedBatchSize: 10,
        dataFeedUpdateInterval: 60,
      },
    };

    expect(() => chainsSchema.parse(chains)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Missing provider. At least one provider is required.',
          path: ['chains', '31337', 'providers'],
        },
      ])
    );
  });

  it('throws on deviationThresholdCoefficient with too many decimals', () => {
    expect(() => deviationThresholdCoefficientSchema.parse(1.234)).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid deviationThresholdCoefficient. A maximum of 2 decimals are supported.',
          path: ['deviationThresholdCoefficient'],
        },
      ])
    );
  });

  it('throws on asyncBeaconUpdatedeviationThresholdFactor that is not an integer', () => {
    expect(() => asyncBeaconUpdatedeviationThresholdFactorSchema.parse(1.234)).toThrow(
      new ZodError([
        {
          code: 'invalid_type',
          expected: 'integer',
          received: 'float',
          message: 'Expected integer, received float',
          path: [],
        },
      ])
    );
  });

  it('throws on asyncBeaconUpdatedeviationThresholdFactor that is not a positive integer', () => {
    expect(() => asyncBeaconUpdatedeviationThresholdFactorSchema.parse(0)).toThrow(
      new ZodError([
        {
          code: 'too_small',
          minimum: 0,
          type: 'number',
          inclusive: false,
          exact: false,
          message: 'Number must be greater than 0',
          path: [],
        },
      ])
    );
  });
});

describe('walletDerivationScheme schema', () => {
  it('parses the walletDerivationScheme as "fixed"', () => {
    const walletDerivationScheme = { type: 'fixed', sponsorAddress: '0x0000000000000000000000000000000000000001' };
    const parsed = walletDerivationSchemeSchema.parse(walletDerivationScheme);

    expect(parsed).toStrictEqual(walletDerivationScheme);
  });

  it('sponsorAddress is present when walletDerivationScheme is "fixed"', () => {
    const walletDerivationScheme = { type: 'fixed' };

    expect(() => walletDerivationSchemeSchema.parse(walletDerivationScheme)).toThrow(
      new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['sponsorAddress'],
          message: 'Required',
        },
      ])
    );
  });

  it('sponsorAddress must be a valid EVM address when walletDerivationScheme is "fixed"', () => {
    const walletDerivationScheme = { type: 'fixed' };

    expect(() => walletDerivationSchemeSchema.parse({ ...walletDerivationScheme, sponsorAddress: '' })).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid EVM address',
          path: ['sponsorAddress'],
        },
      ])
    );
    expect(() =>
      walletDerivationSchemeSchema.parse({ ...walletDerivationScheme, sponsorAddress: '0xinvalid' })
    ).toThrow(
      new ZodError([
        {
          code: 'custom',
          message: 'Invalid EVM address',
          path: ['sponsorAddress'],
        },
      ])
    );
  });
});
