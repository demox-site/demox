# cert-renew source provenance

This package is the missing live `demox-cert-renew` source, recovered on 2026-08-31 from namespace `demox`, qualifier `$LATEST`.

| Artifact | SHA-256 |
| --- | --- |
| Live zip from `GetFunctionAddress` | `25ec75b12f4295604c9c376e7b4d313829a59d3ea315d4ff080455d54812d37d` |
| Live `index.js` from that zip / `GetFunction(ShowCode=TRUE)` | `b98245fb3cbc4e7397f6bdb62a5cc3e717712c7f767646619f01b04c0114fe8b` |
| Live `acme-client` declared range | `^5.4.0` (locked here to `5.4.0`) |

The checked-in `index.js` is **not** a byte-for-byte copy of live `$LATEST`. It is a testable refactor of that source:

- same Let's Encrypt DNS-01 → Tencent SSL → EdgeOne bind flow;
- same default domain, SAN, threshold, zone, and credential environment names;
- APIs and ACME client are injectable so unit tests can prove “not due” exits without writes;
- HTTP error text no longer includes the Tencent Cloud response body.

Do not treat this file as proof that production `demox-cert-renew` already runs the refactored copy. Production still serves the live hash above until a later, explicit function update.
