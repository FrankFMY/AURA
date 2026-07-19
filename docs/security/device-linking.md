# Device linking security model

Status: R1 protocol decision and implementation contract.

## Goal

Link the exact existing Nostr identity to a new browser/device without typing or materializing the 24-word Recovery Code. The new device must create its own user-verified Passkey PRF credential and local encrypted key envelope before the imported identity becomes persistent.

## Trust and threat model

Trusted:

- an already unlocked AURA profile on the source device;
- a fresh user-verification ceremony on the source before transfer;
- a fresh user-verification ceremony on the target before persistence;
- WebCrypto/WebAuthn and the platform CSPRNG.

Untrusted:

- every Nostr relay and network intermediary;
- every received relay event until all signatures, IDs, routing fields, expiry fields and ciphertext authentication checks pass;
- QR/link text until its signed request event, origin, path, lifetime and exact schema pass validation;
- display names;
- browser tabs or component callbacks after their lifecycle generation is stale.

Out of scope:

- a malicious target device deliberately shown to and approved by the user;
- a fully compromised source device while the identity is unlocked;
- traffic-analysis resistance against a relay that observes both devices' connection timing and IP addresses;
- post-quantum secrecy.

## Protocol

1. The target creates a one-time secp256k1 receiver key, 256-bit request ID and five-minute request.
2. The request is an origin-bound, exact-schema Nostr event (`kind 24242`) signed by the receiver key and encoded only in a `/link/#…` fragment.
3. The target subscribes on the request's DM relays to `kind 1059` events addressed to the one-time receiver pubkey. The receiver private key remains only in memory.
4. The already trusted source scans the QR inside AURA (not through a separate Safari storage context), validates the request and shows the same six-digit request fingerprint.
5. Approval performs a fresh WebAuthn PRF assertion against the source profile. The resulting short-lived session creates one NIP-59 response:
   - the inner rumor (`kind 24243`) contains the request binding, exact account secret, display name and DM relays;
   - the seal is signed by the real account identity and NIP-44-encrypted to the one-time receiver;
   - the outer `kind 1059` wrapper is signed by a separate one-time key, NIP-44-encrypted to the receiver and carries only the one-time `p` tag plus expiration.
6. The target verifies the outer signature/ID, decrypts it, verifies the seal signature/ID, decrypts it, verifies the rumor ID and exact schema, then requires:
   - request ID equality;
   - receiver pubkey equality;
   - expiry equality;
   - `seal.pubkey === rumor.pubkey === getPublicKey(transferredSecret)`.
7. The first valid transfer closes the subscription and zeroizes the receiver key. Invalid relay spam is ignored. Expiry, cancellation, lock and unmount also close and zeroize.
8. The target shows the received identity before persistence, creates a fresh local Passkey PRF credential, wraps the transferred secret in a new local envelope, marks the profile recovery-confirmed and zeroizes the transferred buffer.
9. Normal messenger startup replays recipient and sender Gift Wrap copies from configured relays to rebuild local history.

## Security invariants

- The relay-visible wrapper contains no account pubkey, account secret, display name, DM relay list, message content or recovery words.
- The long-term account key never signs the public wrapper; it signs only the encrypted seal.
- Request lifetime is at most five minutes and the target accepts at most one valid response.
- Request, transfer and event parsers reject unknown fields and non-canonical encodings.
- Relay publication succeeds only after at least one relay ACK.
- Linked import never calls recovery-word conversion and never replaces an existing local profile.
- Source approval requires fresh user verification, not merely an existing unlocked JS session.
- Target persistence requires a new local Passkey PRF credential; the source envelope and credential ID are never transferred.
- Owned secret buffers are zeroized on success, cancellation and failure. Immutable URL/ciphertext strings are removed from live UI/history as soon as their role is complete.

## Metadata and reliability trade-off

The response uses stored `kind 1059` rather than ephemeral `kind 21059` so a short relay disconnect does not lose the transfer. It has a five-minute expiration tag and is encrypted exclusively to a one-time receiver key. A relay can still observe the one-time recipient pubkey, approximate timing, payload size and connecting IP addresses. This is an acknowledged NIP-44/NIP-59 limitation.

## Platform decisions

- Do not depend on the `BarcodeDetector` API. It is not broadly available and Safari support remains preference-gated.
- Do not use the iPhone system camera as the primary source-device scanner. Home Screen web apps and Safari can have isolated storage contexts, so a deep link may open without the installed AURA profile.
- Primary source flow: lazy-loaded in-app camera scanner with a pure-JS/worker fallback.
- Required fallback: paste a copied `/link/#…` URL inside the already unlocked AURA profile.
- Target QR generation is local and must not call a remote image/QR service.

## Required validation matrix before release

Automated:

- request mutation, wrong origin/path/query, unknown fields, overlong lifetime and expiry;
- wrapper/seal/rumor tampering and wrong receiver;
- signed identity versus transferred-secret mismatch;
- duplicate/replay, invalid-spam-then-valid, stop, expiry and lifecycle fencing;
- fresh Passkey import, no recovery words, duplicate local identity and zeroization;
- interrupted publication and at-least-one-relay ACK;
- linked startup replay of existing sender-copy history.

Validated by `src/lib/core/device-link.test.ts`, `src/lib/nostr/device-link-runtime.test.ts`, linked-import registry/account-service tests, component boundary tests, the `/link/` fragment privacy E2E, and `e2e/device-link.e2e.ts`. The browser E2E uses two isolated storage contexts, raster QR decoding through the production worker fallback, independent PRF credentials, fresh source assertion, a relay protocol harness, exact npub comparison and pre-link sender-copy replay.

Physical:

- iPhone Safari and installed Home Screen AURA: camera permission, in-app QR scan, source Face ID, target Passkey creation and history replay;
- Android Chrome/PWA equivalent;
- macOS Safari/Chrome target QR and Passkey flow;
- denied camera permission and paste-link fallback.
