export const DEPLOYMENTS = Object.freeze({
  97: Object.freeze({
    chainId: 97,
    chainName: 'BNB Smart Chain Testnet',
    explorerUrl: 'https://testnet.bscscan.com',
    profile: 'legacy',
    sourceCommit: '7a49a6f5668e2ea9e76938a20535eabb6b99e552',
    navVault: '0x73ceDE1e2f51F8FA5448454225d9DB68aEcB8317',
    addresses: Object.freeze({
      hyperAccessControl: '0x9bbefE25f656732015969778dF26e104D2394Bb8',
      stateManager: '0x2a9bb2053dD14b36652f1F6Bc2511b3Eb31b1DCd',
      navOracle: '0x009F0F9507E4e3Fda5159e85fa2f6c19875A3154',
      mintBurnController: '0x563f4C2e62B4917860a4435Da0bF6615648aF28e',
      assetRegistry: '0x50222D8849f44F90fCd911fC5f36387Db8EAD429',
      reservePSM: '0x67D10e814B57E381cE020697eF14CCDf922Dd654',
      poRRegistry: '0x581A7604f9429fF52fa378f2548c28B817e68d17',
      queue: '0xCAd26BEF4ef0E71d2d54b11C1930df2F37bB1080',
      revenuePool: '0x19801Db23a0572dE445c2E73b52b71ff85914EF3',
      unifiedPool: '0x14E9ef574ABd6de2548eDe365F06AA4378010D6a',
      settlement: '0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c',
      vaultFactory: '0x63089ad3826ee02f95819e4c0d10C1080a131a0D',
      adapterFactory: '0x4514Cf0cacEeC515596c0F0EF13eB1290D482860',
      liquidityBridge: '0x7800eBf939427bA561d2d7Ff5Bf6393730A9E101',
      cashVault: '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea',
      noteVault: '0xf95F69488393d73D0cDbFB40e6D6B3494b832242',
      lpVault: '0x6AAAaAe6c30997D7c36E4297b0e44B3eC6126335',
      cashAdapter: '0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4',
      noteAdapter: '0x7ddFB27c9AC47265Fd861A092050c0041A54067c',
      lpAdapter: '0xeEdBb2E9Baae30f450a9D2Ce35286d7CcF132ba1',
    }),
  }),
});

export function getDeployment(chainId) {
  return DEPLOYMENTS[Number(chainId)] ?? null;
}
