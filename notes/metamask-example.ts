import { PrivateKey } from '@textile/hub';
import { BigNumber, providers, utils } from 'ethers';
import { hashSync } from 'bcryptjs';

/**
 * Metamask signing and seed generation adapted from pnlp project. See sources here,
 * https://github.com/pnlp-network/pnlp/blob/91540abea8b51231c2f1e2fe8cc03b7604842d03/pnlp-app/src/app/%40core/persistence/blockchain.service.ts
 * https://github.com/pnlp-network/pnlp/blob/91540abea8b51231c2f1e2fe8cc03b7604842d03/pnlp-app/src/app/%40core/persistence/keystore.service.ts
 */

export type WindowInstanceWithEthereum = Window & typeof globalThis & { ethereum?: providers.ExternalProvider };
class StrongType<Definition, Type> {
  // @ts-ignore
  private _type: Definition;
  constructor(public value?: Type) {}
}
export class EthereumAddress extends StrongType<'ethereum_address', string> {}

export function generateMessageForEntropy(ethereumAddress: EthereumAddress, applicationName: string, secret: string): string {
  return `
********************************************************************************
READ THIS MESSAGE CAREFULLY.
DO NOT SHARE THIS SIGNED MESSAGE WITH ANYONE OR THEY WILL HAVE READ AND WRITE
ACCESS TO THIS APPLICATION.
DO NOT SIGN THIS MESSAGE IF THE FOLLOWING IS NOT TRUE OR YOU DO NOT CONSENT
TO THE CURRENT APPLICATION HAVING ACCESS TO THE FOLLOWING APPLICATION.
********************************************************************************
The Ethereum address used by this application is:

${ethereumAddress.value}



By signing this message, you authorize the current application to use the
following app associated with the above address:

${applicationName}



The hash of your non-recoverable, private, non-persisted password or secret
phrase is:

${secret}



********************************************************************************
ONLY SIGN THIS MESSAGE IF YOU CONSENT TO THE CURRENT PAGE ACCESSING THE KEYS
ASSOCIATED WITH THE ABOVE ADDRESS AND APPLICATION.
AGAIN, DO NOT SHARE THIS SIGNED MESSAGE WITH ANYONE OR THEY WILL HAVE READ AND
WRITE ACCESS TO THIS APPLICATION.
********************************************************************************
`.trim();
}

export async function getSigner() {
  if (!(window as WindowInstanceWithEthereum).ethereum) {
    throw new Error(
      'Ethereum is not connected. Please download Metamask from https://metamask.io/download.html'
    );
  }

  console.debug('Initializing web3 provider...');
  // @ts-ignore
  const provider = new providers.Web3Provider((window as WindowInstanceWithEthereum).ethereum);
  const signer = provider.getSigner();
  return signer
}

export async function getAddressAndSigner(): Promise<{address: EthereumAddress, signer: any}> {
  const signer = await getSigner()
  // @ts-ignore
  const accounts = await (window as WindowInstanceWithEthereum).ethereum.request({ method: 'eth_requestAccounts' });
  if (accounts.length === 0) {
    throw new Error('No account is provided. Please provide an account to this application.');
  }

  const address = new EthereumAddress(accounts[0]);

  return {address, signer}
}

export async function generatePrivateKey(rawSecret: string): Promise<PrivateKey> {
  const metamask = await getAddressAndSigner()
  // avoid sending the raw secret by hashing it first
  const secret = hashSync(rawSecret, 10)
  const message = generateMessageForEntropy(metamask.address, 'textile-demo', secret)
  const signedText = await metamask.signer.signMessage(message);
  const hash = utils.keccak256(signedText);
  if (hash === null) {
    throw new Error('No account is provided. Please provide an account to this application.');
  }
  // The following line converts the hash in hex to an array of 32 integers.
    // @ts-ignore
  const array = hash
    // @ts-ignore
    .replace('0x', '')
    // @ts-ignore
    .match(/.{2}/g)
    .map((hexNoPrefix) => BigNumber.from('0x' + hexNoPrefix).toNumber())
  
  if (array.length !== 32) {
    throw new Error('Hash of signature is not the correct size! Something went wrong!');
  }
  const identity = PrivateKey.fromRawEd25519Seed(Uint8Array.from(array))
  console.log(identity.toString())

  alert(`PubKey: ${identity.public.toString()}. Your app can now generate and reuse this users PrivateKey for creating user Mailboxes, Threads, and Buckets.`);

  // Your app can now use this identity for generating a user Mailbox, Threads, Buckets, etc
  return identity
}
