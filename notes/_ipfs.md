# stats

# https://docs.ipfs.io/reference/cli/#ipfs-stats

Examples:

```s
eric@mbp-16 collabswarm % ipfs stats bitswap
bitswap status
        provides buffer: 0 / 256
        blocks received: 0
        blocks sent: 0
        data received: 0
        data sent: 0
        dup blocks received: 0
        dup data received: 0
        wantlist [0 keys]
        partners [102]
eric@mbp-16 collabswarm % ipfs stats bw
Bandwidth
TotalIn: 12 MB
TotalOut: 626 kB
RateIn: 12 kB/s
RateOut: 264 B/s
eric@mbp-16 collabswarm % ipfs stats dht
DHT wan (123 peers):
  Bucket  0 (13 peers) - refreshed 33m41s ago:
    Peer                                                  last useful  last queried  Agent Version
  @ 12D3KooWLDzYnhqLwRMKoyU6G4SBYj17Q9o7wsRHpfNWJohr655P  never        never         go-ipfs/0.7.0/
  @ 12D3KooWBGRXqdy4sA1Z1FWkkdTQvCYoiEdsV6pWz2BKHcBBgh42  15m12s ago   15m12s ago    hydra-booster/0.7.3
    12D3KooWCC7o1cB3JeCuXHEnyinmJB8FAt9iK32HGTNuqbYjCBKA  never        never         hydra-booster/0.7.3
    QmQMVrWRjnXXwAGgSxwhTwUujUbz9SKmNbnQBj1Ai9FLAW        never        never         go-ipfs/0.8.0/48f94e2
  @ 12D3KooWQKG74VjvMUdAnPHU2DYs5p7VfzJSpmBADRsaurbNbLHG  34m41s ago   15m13s ago    go-ipfs/0.8.0/
    QmXq18nP1UD2yxbXGHNV6pU2j7SPdFfqCVB379iYbgVSC7        34m43s ago   34m43s ago    go-ipfs/0.8.0/48f94e2
  @ QmdZtuBfWh6FCJeBfqKNAucx7QkFcvyE6JLURPR6aXZrKh        34m43s ago   34m43s ago    go-ipfs/0.6.0/
    QmZHsTUmUDB7wRtEsyqadPZTdVTYEdvHY3JW4dM4KjirnR        34m43s ago   34m43s ago    go-ipfs/0.8.0/48f94e2
    QmSA6Vf57a9wPsyvUAX5o4KcDsEEMFBVp6iyj2d6QxyAny        34m44s ago   34m44s ago    go-ipfs/0.8.0/48f94e2
    QmPhiZipWiFgtov2xXryr7NDZopFuH7na2h3cg4vANRLJi        34m45s ago   34m45s ago    go-ipfs/0.8.0/48f94e2
    12D3KooWG8fh2u4uJV5TUuWxjuzzxKtu88hbJ6KSfJoYZ1xbsGUc  34m45s ago   34m45s ago    go-ipfs/0.7.0/
    QmSqY8GAv7jhf1w3LjXTwfvWaRsPZNNaqDZ3PUqcSeu5uS        34m45s ago   34m45s ago    go-ipfs/0.8.0/48f94e2
    QmQK6o5K23z3CdMk6ae8mNsYWUB5DbxmoEyknFjzK6GUPs        34m45s ago   34m45s ago    storm

  Bucket  1 (20 peers) - refreshed 5m0s ago:
    Peer                                                  last useful  last queried  Agent Version
    QmNcbSK4PnNBtSt1qDmPgVtDbDdG3RV2ptXY7gGNvQJacS        4m46s ago    4m46s ago     storm
    12D3KooWEfzNLwbjpGwDYjF6AKtu8hHudzXkVWmkFWyxXA3KUBCX  4m46s ago    4m46s ago     go-ipfs/0.8.0/ce693d7
    QmXLipFDgbc4RnK9HuQYcNqy1fWK2VZ3ZZrgTp8nEQdo5D        4m47s ago    4m47s ago     go-ipfs/0.8.0/48f94e2
  @ 12D3KooWPdaS12YCKMGMN2gf3xNJqvTrr6MPRyEAF68fjk5faELf  4m48s ago    4m48s ago     go-ipfs/0.9.0/9524da92c7
    Qmd3YxCM4iu33iLWGywc1ukNnCv3JWSiB9eyiAoCwJoMvZ        4m48s ago    4m48s ago     go-ipfs/0.8.0/48f94e2
    12D3KooWHkWr32HnTwkoGYSiqmVQvvFHoC4vQvvKkNTGXCdJPyqk  4m49s ago    4m49s ago     go-ipfs/0.7.0/
    QmRHxSPZAFVZt9vL4qHnPqChtsdpFMFhLdRBSjsR2ygPRn        4m49s ago    4m49s ago     storm
    QmPJ5CVbGKWTUeRJ6nd1PQy2CE94iZ3ESUf8PD8URThe95        4m50s ago    4m50s ago     go-ipfs/0.4.23/
    QmXik1gSTb3EdRrcgFzvLXRjZCAUk7yWA376iY5AuGpRGw        4m50s ago    4m50s ago     go-ipfs/0.8.0/48f94e2
  @ 12D3KooWLVHzEg1daoKP4AvDkYZyb7Jm8J8dLVdF2YKVEN1Yz7RY  4m50s ago    4m50s ago     go-ipfs/0.7.0/
    QmYeNpA59tgQmJk4FmeYnESNUkra7ZdqHraHx38QZtwTGE        4m50s ago    4m50s ago     storm
  @ 12D3KooWMwa8KgNcjdnfqQC6v4wfQDEGQNW2NC2ENVJ99ZujW46U  4m50s ago    4m50s ago     go-ipfs/0.8.0/ce693d7e8
    12D3KooWKrB93pwXDdeyz2WRMwcSBny5ECjA1JasB4GTo4ijUUtf  4m51s ago    4m51s ago     go-ipfs/0.8.0/ce693d7e8
    QmTw7A97a4srH5hP1Q839M5727n4dGZamsbhcZaymaToGr        4m51s ago    4m51s ago     go-ipfs/0.8.0/48f94e2
    QmQKhgy8AtFjSDWoNhMjzTWnzqV5J6hYXUS2hjKLiAWreG        4m51s ago    4m51s ago     go-ipfs/0.8.0/48f94e2
    QmaYHqgYfqEheHm9rKfg1ZPSmrRqWYYSUctjuJYLzRyTFa        4m51s ago    4m51s ago     go-ipfs/0.8.0/48f94e2
    QmPSwEgedR8Azcx6HGmdURQSKmfvFDGG9UrqGyCwZU8MzW        4m52s ago    4m52s ago     go-ipfs/0.8.0/48f94e2
    QmUxx61Z54K1h48kKAGBQ3Xzoo7HE23p7ADpE1Rx6nyHKs        4m52s ago    4m52s ago     go-ipfs/0.8.0/48f94e2
    QmemPZCtZaQmD32aU3vdaLZGZsRQmsmJvkvX1YUw9GRfH1        4m52s ago    4m52s ago     storm
  @ 12D3KooWFiVXj37XvnCMA1MfoHPtdjEy81mQEiwjrBAwAYrjFw93  4m53s ago    4m53s ago     go-ipfs/0.8.0/ce693d7

  Bucket  2 (20 peers) - refreshed 15m54s ago:
    Peer                                                  last useful  last queried  Agent Version
    12D3KooWJ9W9eAzxUAzjWLr4eps9brXbsYeZkUt7471LDEdSQXFb  never        never         go-ipfs/0.8.0-dev/1168639
    QmYTGr22qwVswCkCAnaZBXECsbsxLfw8seFT62ycYgm6CM        never        never         storm
    QmNMdBo2VzfadGJ65BpmEYAeXpjxhshg2Y7WqRHJFsc9js        never        never         go-ipfs/0.8.0/48f94e2
    QmPhu9KNxtQHYhWrwGDW52mj2XtNSn9jMbogk94f75KYFA        never        never         storm
    QmYiN9WbWTV6L5ghNxqh7cauMX3DjAAZSNfnGjbAtTk9Ao        never        never         storm
    12D3KooWLLb6or5GuotADSiZnqu1jd9qMUyxa3iJL3pGFLHwUrGV  never        never         hydra-booster/0.7.3
    QmbxsyFzmdNRkSGHzm44RoPGcrf8ubB9qZm19Z3sVjqRTR        never        never         go-ipfs/0.8.0/48f94e2
    QmYVnfRJf5TyfvXeH6yEctKo7HDVxK7WsQsa979jY8EmbA        never        never         go-ipfs/0.8.0/48f94e2
    QmYuogWP5DsMgfNfJCetGnwv3vn14TxQGyNtYET2jSfjqb        never        never         go-ipfs/0.8.0/48f94e2
    QmVrEj2FjCKF8Kvc7TEi3ppTDmPVgHnVGk7Bc92whLYq71        never        never         go-ipfs/0.8.0/48f94e2
    QmRPyRjHHkGFeTrPpsLjYmaxxNsQVnF7sw6LhW2xbz7EfP        never        never         go-ipfs/0.8.0/48f94e2
    QmQgzQ8Xx8fH9fcsoh6JU2Zx2gaNA6CV4EG83tcqSQ559N        never        never         go-ipfs/0.7.0/
    QmXrcYEiETTAHKyadDJdFRUvQxqowc8Dtqu1k8xXTfpJsz        never        never         storm
    QmTXGAkvzLV4KxvgDsqGQuZduG4QRW2PDvr92Ks2C3fjQZ        16m12s ago   16m12s ago    go-ipfs/0.8.0/48f94e2
    QmcZrBqWBYV3RGsPuhQX11QzpKAQ8SYfMYL1dGXuPmaDYF        never        never         go-ipfs/0.8.0/
    QmbnHvnz4chvqBbL27xycTamkEdQgcony9SS8gAhEgu284        16m12s ago   16m12s ago    go-ipfs/0.8.0/48f94e2
    QmVmes53hDezxT8Y3uH77eipey12TBUX8j7EtBBRKGMi3c        16m12s ago   16m12s ago    storm
    QmQx8HrW8oF7caUPrYgQ9dPkVPMhXCQFs4tCrS7D4nD9Wv        16m12s ago   16m12s ago    storm
    12D3KooWGEEry63YvRUKbC56NcwB4jgPC3wWztPrYNKKW9D4pkvq  16m12s ago   16m12s ago    go-ipfs/0.7.0/
    QmNMoaQz5KCXUXDbcPCaU9H3CicnwGgTpxDypXmN3WRmCL        16m12s ago   16m12s ago    go-ipfs/0.8.0/48f94e2

  Bucket  3 (15 peers) - refreshed 34m55s ago:
    Peer                                                  last useful  last queried  Agent Version
  @ 12D3KooWRdZD9x6w62hgb7eFXvB6UXdDo19TeoqhvAPc6w8Rdj3v  never        never         go-ipfs/0.8.0/ce693d7e8
    QmUWuwuF4fbbqxxWDtVjmTG3VGMGFoRrHZEoLkEFFdC7e8        never        never         go-ipfs/0.8.0/48f94e2
  @ 12D3KooWE3vzpSuLVEbSBfgubBW4mf7TcfDvmsMzzVQWWWFuk1HV  13m13s ago   13m13s ago    go-ipfs/0.8.0/ce693d7
    QmVaNqiRtJ8A1VB9fmZNr2E2HSEtYd9RE5RqbKmMtANxj6        never        never         go-ipfs/0.8.0/ce693d7
    QmQv7iVQTfnUEmEYGVu93q6pArMvkw1MTR9DZ88TFeudWU        35m13s ago   35m13s ago    go-ipfs/0.4.22/
    QmNtsCqh3coWTi9hHqhbNWYqcJF4rxM8d2eWoG6s11oz4h        35m13s ago   35m13s ago    go-ipfs/0.8.0/48f94e2
    QmTy6biyJkK69pMg33NRaTKm7qeBRBHiyskN73bULZD7vC        35m13s ago   35m13s ago    go-ipfs/0.8.0/48f94e2
    QmYY9AJuF6SV5CNUsS5zGELhF8Hb9RzgAVzfMEJSqfoX82        35m13s ago   35m13s ago    go-ipfs/0.8.0/48f94e2
    QmbCA27E1rL6V6upajtwuKEQ64Pvzu5WrEqXnAnj9TFsxT        35m13s ago   35m13s ago    go-ipfs/0.6.0/
    QmNarefMcphWYdXgccGZAEPJyWTE6yxQ1sm8uEp4ra2fMV        35m13s ago   35m13s ago    go-ipfs/0.6.0/
    QmSarArpxemsPESa6FNkmuu9iSE1QWqPX2R3Aw6f5jq4D5        35m14s ago   35m14s ago    go-ipfs/0.9.0/f45ff688f
    QmbmemP6mt8cxY5RBp7Tbjz9nPisumPAziGv188ycbtwnq        35m14s ago   35m14s ago    go-ipfs/0.8.0/48f94e2
    12D3KooWHEAFqWxQ2YBtVr5kkfF234Wpm7gz2cYjdS7cQYF1GNrH  35m14s ago   35m14s ago    go-ipfs/0.8.0/ce693d7
    QmTpjArrMDHJ7MLxasYLVEbiTZN5rsT7U42nR3WxNFgjpB        35m14s ago   35m14s ago    go-ipfs/0.8.0/48f94e2
    12D3KooWDu7e7qgH9VYigLLjs17kc1S32gTH2992usGBJCuS5h4a  35m13s ago   35m15s ago    hydra-booster/0.7.3

  Bucket  4 (12 peers) - refreshed 35m13s ago:
    Peer                                                  last useful  last queried  Agent Version
  @ QmcfJeB3Js1FG7T8YaZATEiaHqNKVdQfybYYkbT1knUswx        never        never         go-ipfs/0.8.0/
    QmUs4N8Sydg8yTHBsoV2WktjBqr3WnemtqZuMSoX3u1tzA        34m48s ago   34m48s ago    storm
    Qma2tnmCBdDZSZ81LVvkdUzz6xB1phpuDDMj5U6PK3nkwB        34m48s ago   34m48s ago    go-ipfs/0.8.0/48f94e2
    QmeY62YnxEv4Ej72jzj1Xuye6dh3A5Gf91kSToALr94LYz        34m48s ago   34m48s ago    go-ipfs/0.8.0/48f94e2
    12D3KooWQ1fr7J9hWpHWCsXqN8d7etBbTj4rLnVwgxm8EMUuAsCz  34m48s ago   34m48s ago    go-ipfs/0.7.0/
    12D3KooWF7rT2wJEFgxku2Ftba4BVRgae26MSCbJ23Wg7H13kcKg  34m48s ago   34m48s ago    hydra-booster/0.7.3
    QmYTt7onwcADNWnHqQhjXhf4XHkqxP9kDM94TR8dxFJ2nb        34m48s ago   34m48s ago    go-ipfs/0.8.0/48f94e2
    12D3KooWHU3KiThjwGzANjXDxjvrRnxyaQCGXA9RhndS6y6Bo8vu  34m48s ago   34m48s ago    go-ipfs/0.8.0/
    12D3KooWNDKXeT9h7kY9Jxfhas713jk9tngDrFFoe1GpgpgbNM5Z  34m50s ago   34m50s ago    go-ipfs/0.7.0/ea77213
    QmP54Jcw64q1hq3oLwyehtYRa5rW8upyUq5TGvxBsTfNkV        34m50s ago   34m50s ago    go-ipfs/0.6.0/
    12D3KooWRPDSq7nr3NwrUbUHNVBJvBURNwUWYrcfS2vh5vW1fv2A  34m50s ago   34m50s ago    go-ipfs/0.8.0/ce693d7
    QmUgmRxoLtGERot7Y6G7UyF6fwvnusQZfGR15PuE6pY3aB        34m50s ago   34m50s ago    go-ipfs/0.8.0/

  Bucket  5 (20 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ 12D3KooWCcjXvzo7dougCJyBk1BAGJkeJiqs9SxiHDcKx1sLTXHQ  never        never         hydra-booster/0.7.3
    QmWuiFSjdsVKJcnEEHL5TnmuJtyp9JJk24EFCPD4GSoiwd        never        never         storm
    QmPBi73VDUWmgDRWnW9yzGkosjTZQncLraQwNayWyuPB9C        never        never         storm
    QmV3DC2u9uBaRB3MwLJQBugMEwC9i2y97j9vpK7ECBVYCw        never        never         go-ipfs/0.8.0/48f94e2
    Qmciv1oo4QV2wN5QDeymvcMiQ6WesDygbbE4N6jv6ErDh8        never        never         go-ipfs/0.4.22-rc1/
    QmRwzk3KkXMGqpSEApeHoAURhsZWnSDGNn7Z4yD8U3FEBx        never        never         storm
  @ 12D3KooWCNSZPtf2PzVmWMyGVBJBi3es8y5Ao4JQVuvuK49SJZht  never        never         go-ipfs/0.8.0/
    12D3KooWAc7CGBk4Bd9Cj5xvQjq85925xACEMiegfmK3SAzh89SX  never        never         go-ipfs/0.8.0/
    QmaE54gHWiQYZ2emBF4wrjPodprriPFNnQhwxaN5hUKqrF        never        never         go-ipfs/0.8.0/48f94e2
    QmWKaQw9Fu5Lv4k4eu5NEivvZJUKFmh1KjryNvsJmBopKW        never        never         storm
    QmWsci1GeQX1zg7FSrA8ogELySdte7TSZTxhrKkg4fZ2nF        10m28s ago   10m28s ago    go-ipfs/0.8.0/48f94e2
    QmRmFC6k1j5VmPn43ZB2i5AgNETF7iZuJAhfvKkfjruBPJ        10m28s ago   10m28s ago    go-ipfs/0.8.0/48f94e2
    QmQVD3SEa2pNTu8HmoSUxeKh5yyEwi7HWZKyy8f3Bm6wBc        10m28s ago   10m28s ago    go-ipfs/0.8.0/48f94e2
    QmZ8D3rJQN94gCo15v1YKLQNADNo842yTAkD4fhQVK1LEr        10m28s ago   10m28s ago    go-ipfs/0.8.0/48f94e2
    QmVwsjzY9a2nNm6t77C9ZQ6DmNfaevsVTc3RMDAjSeSKew        10m28s ago   10m29s ago    storm
    12D3KooWLbuyPrZVzPjVd99Z3Gs6SqFGpGmX2Td3pEmMFTELCCJ8  10m29s ago   10m29s ago    go-ipfs/0.7.0/
  @ QmX2oR4kHBYM3qBHGyMb9Z33HNZpUuLocynMp7rmGweuQe        10m29s ago   10m29s ago    go-ipfs/0.6.0/
    12D3KooWFGYxEqR2M2XCuzwyvuyxdaTEyMF1pvz9RTYyHSk7VVNF  10m29s ago   10m29s ago    go-ipfs/0.8.0/ce693d7e8
    QmVD4nW9SfgBgY4GZxLUc7TPUmpVHPHPwjcKFmsR1Ya3S4        10m28s ago   10m29s ago    go-ipfs/0.8.0/48f94e2
    QmR99EzXjuCyHy1bw5gc8PoiM9pU3QYxQUt5Kv12LEDN34        10m28s ago   10m29s ago    go-ipfs/0.8.0/48f94e2

  Bucket  6 (1 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ QmTiZLjSAbGZh9nLMHPE5ES5SeFHMBJm6C7XVadSpSjYNw        32m53s ago   32m53s ago    go.vocdoni.io/dvote

  Bucket  7 (1 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ 12D3KooWAuMTLB3XF8MJKRLqNxZF5cTjHP29LrhCzsr5rAqvRXHG  35m13s ago   9m13s ago     go-ipfs/0.9.0/

  Bucket  8 (5 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
    QmSnXwXQ4XDWhCDHMvtspT4hcBMRtZy4pVcUPFaSpWSCNF        4m8s ago     4m8s ago      go-ipfs/0.8.0/48f94e2
    QmXf1pyCfnupeMxnyQKWsGi7z3qdJQbeiePFPCLbvUL9vn        5m3s ago     5m3s ago      go-ipfs/0.4.22/
  @ 12D3KooWGoyFwiWSRWiWUxmDXtmcKfDhtTNdDBceS579pUmn9iSW  9m3s ago     8m2s ago      hydra-booster/0.7.3
  @ 12D3KooWKp1ybcZjooGcdBNswU9BfRHoYKyR6ULArtPLLtN9oCC2  36m56s ago   8m13s ago     go-ipfs/0.7.0/ea77213
  @ QmPo1ygpngghu5it8u4Mr3ym6SEU2Wp2wA66Z91Y1S1g29        36m58s ago   8m13s ago     go-ipfs/0.9.0/f45ff688f

  Bucket  9 (7 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ 12D3KooWL7Ru7zqkUxuadZpaoRuxupJYPCgDNU69vZ8sTkjVP6K4  52s ago      8s ago        hydra-booster/0.7.3
  @ QmTFD34B5ccr1ZtUTVur7HpDDahnt1WrW7JNeypQWiW7f4        16m11s ago   5m3s ago      go-ipfs/0.8.0/48f94e2
    QmeX1MHsAnxtAQcpgDdsf4B3zEA8uQBP3exY2rqD4YugCV        16m12s ago   4m13s ago     go-ipfs/0.8.0/48f94e2
  @ 12D3KooWR8USxEfboENteNMnQnDAjWkv4m1GNPXxFcLXTmYAjutV  16m12s ago   5m3s ago      go-ipfs/0.8.0/ce693d7
  @ 12D3KooWCyHxCJvs99DThaRw5wrQakjwqvjuXvvoDNaL2gVS3rZq  36m56s ago   8s ago        go-ipfs/0.7.0/
  @ QmTtXA18C6sg3ji9zem4wpNyoz9m4UZT85mA2D2jx2gzEk        36m57s ago   8s ago        go-ipfs/0.6.0/
  @ QmbWCzyHLmjgTrE2xAmaHh1hko2L9mRFh5C6ePwfmxuAHF        5m3s ago     8s ago        go-ipfs/0.6.0/

  Bucket 10 (7 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ QmSgrR8MqYb5h6qvHpVqf6mTHBngskRi8qxNcj18nR1zkn        5m3s ago     5m3s ago      go-ipfs/0.8.0/48f94e2
  @ Qmdk1wuKU7RFCV5msYeuDGj9gXfkW2pjHAHBh5sYJ9BLxL        16m11s ago   5m3s ago      storm
  @ QmeESqmxGfnwuuHvenseSHuy1HyFai1SBr9W8gTPNRNE9X        16m12s ago   5m3s ago      go-ipfs/0.8.0/48f94e2
  @ 12D3KooWB3MxqQxXejrVJkmaJsdfpNZ2PWj8iP2j6XzoJLkZsKLj  36m58s ago   13s ago       go-ipfs/0.7.0/ea77213
  @ 12D3KooWSJ7Jt7y62eic1oxdqTDMnBJ4roUDPhikfQCueGqbaAnE  5m3s ago     13s ago       go-ipfs/0.8.0/
  @ 12D3KooWJZTymtUsvMP8ZyMammvxGLgRgtg6pcEhZS9jxD7hd48E  5m3s ago     13s ago       go-ipfs/0.8.0/28bea0ee5
  @ 12D3KooWBHBzTtotosqDcDYuTjLoReWsynXiM547f6JYKL9JSjjY  36m58s ago   4m13s ago     go-ipfs/0.8.0/ce693d7

  Bucket 11 (1 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ QmdM5PSgyvv1jBJb16y912hMCXWhohQzB5aW5dyTiTwp8T        16m11s ago   5m3s ago      go-ipfs/0.8.0/48f94e2

  Bucket 12 (0 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version

  Bucket 13 (0 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version

  Bucket 14 (0 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version

  Bucket 15 (0 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version

  Bucket 16 (1 peers) - refreshed never:
    Peer                                                  last useful  last queried  Agent Version
  @ Qma8aXLQeCsp5dmRpaLdSZm6EETSggxsQK79D7furc2pJ2        16m12s ago   5m3s ago      storm

DHT lan (0 peers):
eric@mbp-16 collabswarm % ipfs stats provide
Error: can only return stats if Experimental.AcceleratedDHTClient is enabled
eric@mbp-16 collabswarm % ipfs stats repo
NumObjects: 1126
RepoSize:   286406665
StorageMax: 10000000000
RepoPath:   /Users/eric/.ipfs
Version:    fs-repo@11
eric@mbp-16 collabswarm % ipfs repo stat
NumObjects: 1126
RepoSize:   286406665
StorageMax: 10000000000
RepoPath:   /Users/eric/.ipfs
Version:    fs-repo@11
```
