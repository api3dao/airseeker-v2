import { ethers } from 'ethers';

import {
  airseekerV2ProviderRecommendedGasPrice,
  multiplyGasPrice,
  setLastTransactionDetails,
  setStoreGasPrices,
  updateGasPriceStore,
  gasPriceStore,
  clearExpiredStoreGasPrices,
} from './gas-price';

const chainId = '31337';
const rpcUrl = 'http://127.0.0.1:8545/';
const gasSettings = {
  recommendedGasPriceMultiplier: 1.5,
  sanitizationSamplingWindow: 15,
  sanitizationPercentile: 80,
  scalingWindow: 2,
  scalingMultiplier: 2,
};
const timestampMock = 1_696_930_907_351;
const gasPriceMock = ethers.utils.parseUnits('10', 'gwei');

describe('gas price', () => {
  describe('clearExpiredStoreGasPrices', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId] = { gasPrices: [], lastUpdateTimestamp: 0, lastUpdateNonce: 0 };
    });

    it('clears expired gas prices from the store', () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
      clearExpiredStoreGasPrices(chainId, gasSettings.sanitizationSamplingWindow);
      setStoreGasPrices(chainId, gasPriceMock);

      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([{ price: gasPriceMock, timestamp: timestampMock }]);
    });
  });

  describe('setStoreGasPrices', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId] = { gasPrices: [], lastUpdateTimestamp: 0, lastUpdateNonce: 0 };
    });

    it('updates store with price data', () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      setStoreGasPrices(chainId, gasPriceMock);

      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([{ price: gasPriceMock, timestamp: timestampMock }]);
    });
  });

  describe('updateGasPriceStore', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId] = { gasPrices: [], lastUpdateTimestamp: 0, lastUpdateNonce: 0 };
    });

    it('returns and updates store with price data', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const gasPrice = await updateGasPriceStore(chainId, rpcUrl);

      expect(gasPrice).toStrictEqual(gasPriceMock);
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([{ price: gasPriceMock, timestamp: timestampMock }]);
    });

    it('clears expired gas prices from the store', async () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
      clearExpiredStoreGasPrices(chainId, gasSettings.sanitizationSamplingWindow);
      const gasPrice = await updateGasPriceStore(chainId, rpcUrl);

      expect(gasPrice).toStrictEqual(gasPriceMock);
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([{ price: gasPriceMock, timestamp: timestampMock }]);
    });
  });

  describe('setLastTransactionDetails', () => {
    it('sets last transcation details', () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      setLastTransactionDetails(chainId, 3);

      expect(gasPriceStore[chainId]!.lastUpdateNonce).toBe(3);
      expect(gasPriceStore[chainId]!.lastUpdateTimestamp).toStrictEqual(timestampMock);
    });
  });

  describe('airseekerV2ProviderRecommendedGasPrice', () => {
    beforeEach(() => {
      // Reset the gasPriceStore
      gasPriceStore[chainId] = { gasPrices: [], lastUpdateTimestamp: 0, lastUpdateNonce: 0 };
    });

    it('gets, sets and returns provider recommended gas prices', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([{ price: gasPriceMock, timestamp: timestampMock }]);
    });

    it('gets and uses the percentile price from the store', async () => {
      const gasPricesMock = Array.from(Array.from({ length: 10 }), (_, i) => ({
        price: ethers.utils.parseUnits(`${i + 1}`, 'gwei'),
        timestamp: timestampMock,
      }));
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = gasPricesMock;
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(
        multiplyGasPrice(ethers.utils.parseUnits('8', 'gwei'), gasSettings.recommendedGasPriceMultiplier)
      );
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        ...gasPricesMock,
      ]);
    });

    it('clears expired gas prices from the store', async () => {
      const oldGasPriceMock = {
        price: ethers.utils.parseUnits('5', 'gwei'),
        timestamp: timestampMock - gasSettings.sanitizationSamplingWindow * 60 * 1000 - 1,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
      await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([{ price: gasPriceMock, timestamp: timestampMock }]);
    });

    it('returns new price if it is within the percentile', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('11', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestamp: timestampMock,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.recommendedGasPriceMultiplier));
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        oldGasPriceMock,
      ]);
    });

    it('returns sanitized price if new price is above the percentile', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestamp: timestampMock,
      };
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(oldGasPriceValueMock, gasSettings.recommendedGasPriceMultiplier));
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        oldGasPriceMock,
      ]);
    });

    it('applies scaling if past the scaling window and same nonce', async () => {
      const oldGasPriceValueMock = ethers.utils.parseUnits('5', 'gwei');
      const oldGasPriceMock = {
        price: oldGasPriceValueMock,
        timestamp: timestampMock,
      };
      const nonceMock = 1;
      jest.spyOn(Date, 'now').mockReturnValue(timestampMock);
      jest
        .spyOn(ethers.providers.StaticJsonRpcProvider.prototype, 'getGasPrice')
        .mockResolvedValueOnce(ethers.BigNumber.from(gasPriceMock));

      gasPriceStore[chainId]!.gasPrices = [oldGasPriceMock];
      gasPriceStore[chainId]!.lastUpdateNonce = nonceMock;
      gasPriceStore[chainId]!.lastUpdateTimestamp = timestampMock - gasSettings.scalingWindow * 60 * 1000 - 1;
      const gasPrice = await airseekerV2ProviderRecommendedGasPrice(chainId, rpcUrl, gasSettings, nonceMock);

      expect(gasPrice).toStrictEqual(multiplyGasPrice(gasPriceMock, gasSettings.scalingMultiplier));
      expect(gasPriceStore[chainId]!.gasPrices).toStrictEqual([
        { price: gasPriceMock, timestamp: timestampMock },
        oldGasPriceMock,
      ]);
    });
  });
});