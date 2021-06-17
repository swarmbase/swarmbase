import { SubtleCrypto } from "./auth-subtlecrypto";

const auth = new SubtleCrypto();

let keyPair: CryptoKeyPair;

export async function setup_keys(): Promise<CryptoKeyPair> {
	keyPair = await crypto.subtle.generateKey(
		{
			name: "ECDSA",
			namedCurve: "P-384",
		},
		true,
		["sign", "verify"]
	);
	return keyPair;
}
