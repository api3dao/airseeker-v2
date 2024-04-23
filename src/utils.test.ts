import { ethers } from 'hardhat';

import {
  deriveSponsorAddressHashForManagedFeed,
  deriveSponsorAddressHashForSelfFundedFeed,
  deriveSponsorWallet,
  deriveSponsorWalletFromSponsorAddressHash,
  encodeDapiName,
} from './utils';

describe(deriveSponsorWalletFromSponsorAddressHash.name, () => {
  describe(deriveSponsorAddressHashForManagedFeed.name, () => {
    it('derives different wallets for dAPIs with same prefix', () => {
      const dapiName = encodeDapiName('Ethereum - Avalanche');
      const otherDapiName = encodeDapiName('Ethereum - Avalanche (DEX)');
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorAddressHash = deriveSponsorAddressHashForManagedFeed(dapiName);
      const sponsorWallet = deriveSponsorWalletFromSponsorAddressHash(sponsorWalletMnemonic, sponsorAddressHash);
      const otherSponsorAddressHash = deriveSponsorAddressHashForManagedFeed(otherDapiName);
      const otherSponsorWallet = deriveSponsorWalletFromSponsorAddressHash(
        sponsorWalletMnemonic,
        otherSponsorAddressHash
      );

      expect(sponsorWallet.address).not.toBe(otherSponsorWallet.address);
    });

    it('works with data feed ID', () => {
      const dataFeedId = '0x917ecd1b870ef5fcbd53088046d0987493593d761e2516ec6acc455848976f36';
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorAddressHash = deriveSponsorAddressHashForManagedFeed(dataFeedId);
      const sponsorWallet = deriveSponsorWalletFromSponsorAddressHash(sponsorWalletMnemonic, sponsorAddressHash);

      expect(sponsorWallet.address).toBe('0x6fD46d2D7AB4574Be0185618944106fdaF20DB7D'); // Note, that the address is different if the sponsor address hash is derived using the "self-funded" scheme.
    });
  });

  describe(deriveSponsorAddressHashForSelfFundedFeed.name, () => {
    it('derives a wallet for a self-funded feed', () => {
      const dataFeedId = '0x917ecd1b870ef5fcbd53088046d0987493593d761e2516ec6acc455848976f36';
      const updateParameters =
        '0x0000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000000000064';
      const sponsorWalletMnemonic =
        'diamond result history offer forest diagram crop armed stumble orchard stage glance';

      const sponsorAddressHash = deriveSponsorAddressHashForSelfFundedFeed(dataFeedId, updateParameters);
      const sponsorWallet = deriveSponsorWalletFromSponsorAddressHash(sponsorWalletMnemonic, sponsorAddressHash);

      expect(sponsorWallet.address).toBe('0x08E47E2dF1440492289da760B58d036b3abb1A43'); // Note, that the address is different if the sponsor address hash is derived using the "managed" scheme.
    });
  });
});

describe(deriveSponsorWallet.name, () => {
  it('derives a wallet for a managed feed', () => {
    const dapiName = encodeDapiName('Ethereum - Avalanche');
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName, 'does-not-matter', { type: 'managed' });

    expect(sponsorWallet.address).toBe('0xDF5Eb6273BdB4608e70Bb0ABCA0571B45Cb60a22'); // Note, that the address is different if the sponsor address hash is derived using the "self-funded" scheme.
  });

  it('derives a wallet for a self-funded feed', () => {
    const dapiName = encodeDapiName('Ethereum - Avalanche');
    const updateParameters =
      '0x0000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000002faf0800000000000000000000000000000000000000000000000000000000000000064';
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName, updateParameters, {
      type: 'self-funded',
    });

    expect(sponsorWallet.address).toBe('0x1e0cb43e47bf4335d21812C2d652fC83F2CB64Bb'); // Note, that the address is different if the sponsor address hash is derived using the "managed" scheme.
  });
});

test('ethers compatibility for Wallet.fromMnemonic', () => {
  const wallet = ethers.Wallet.fromPhrase(
    'arrange actress together floor menu parade dawn abandon say swear excess museum'
  );

  expect(wallet.address).toBe('0xE1f7E4662F92e5DaDB9529Efb2EE61ec63b028e3');
});
