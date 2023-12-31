import { deriveSponsorWallet, deriveWalletPathFromSponsorAddress, encodeDapiName } from './utils';

describe(deriveSponsorWallet.name, () => {
  it('derives different wallets for dAPIs with same prefix', () => {
    const dapiName = encodeDapiName('Ethereum - Avalanche');
    const otherDapiName = encodeDapiName('Ethereum - Avalanche (DEX)');
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dapiName);
    const otherSponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, otherDapiName);

    expect(sponsorWallet.address).not.toBe(otherSponsorWallet.address);
  });

  it('works even with data feed ID', () => {
    const dataFeedId = '0x917ecd1b870ef5fcbd53088046d0987493593d761e2516ec6acc455848976f36';
    const sponsorWalletMnemonic = 'diamond result history offer forest diagram crop armed stumble orchard stage glance';

    const sponsorWallet = deriveSponsorWallet(sponsorWalletMnemonic, dataFeedId);

    expect(sponsorWallet.address).toBe('0x6fD46d2D7AB4574Be0185618944106fdaF20DB7D');
  });
});

describe(deriveWalletPathFromSponsorAddress.name, () => {
  it('derives the correct wallet path from the sponsor address', () => {
    expect(deriveWalletPathFromSponsorAddress('0xE2c582D05126E09734cAFABea8A0E56E9B827629')).toBe(
      '5/461534761/1363266269/1395387130/154600633/743976197/28'
    );
    expect(deriveWalletPathFromSponsorAddress('0x86D3763039cA6BABe616755Ceb58e19f3388D9AB')).toBe(
      '5/864606635/1454490430/408540531/1314086239/1832346371/16'
    );
  });
});
