# algorithms

## subtle

### encrypt/decrypt

#### symmetric

**AES-GCM** is recommended because it uses authenticated encryption by default, which checks changes to the message.[1] [[example](https://github.com/mdn/dom-examples/blob/master/web-crypto/encrypt-decrypt/aes-gcm.js)]

Requires use of initialized vector. This is a random seed attached to the start of the message. Contents can be public and is often simply appended to the start of the encrypted message. Since we set the length and type in `encrpyt()`, in `decrypt()` we can use those values to separate out the iv, and use that to decrypt the message.[2] [3] [4]

[1]: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt#supported_algorithms

[2]: https://en.wikipedia.org/wiki/Initialization_vector

[3]: https://proandroiddev.com/security-best-practices-symmetric-encryption-with-aes-in-java-7616beaaade9

[4]: https://security.stackexchange.com/a/17046

# #metamask 

Has it's own security algorithms.

Seems to like the SHA-3 keccak256. [6]

There is a faster version for short messages, may not be part of the NIST standard. [5]

[5]: https://en.wikipedia.org/wiki/SHA-3#KangarooTwelve

[6]: https://medium.com/metamask/eip712-is-coming-what-to-expect-and-how-to-use-it-bb92fd1a7a26