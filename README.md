# AURA

**Private conversations with identity you control.**

AURA is a focused, browser-based Nostr messenger. It implements encrypted one-to-one messages without a central account provider, social feed, wallet, or automatic downgrade to legacy direct messages.

[Open AURA](https://aura.frankfmy.com)

## What it does

- Encrypts direct messages with NIP-44, NIP-17, and NIP-59.
- Creates one immutable rumor and independent recipient/sender Gift Wraps.
- Uses the recipient's signed kind-`10050` relay list; no list means no publication.
- Persists exact encrypted wire events before the first network attempt.
- Retries the same event IDs and reports relay acceptance honestly.
- Deduplicates received messages by canonical rumor ID.
- Keeps each identity in a physically separate IndexedDB database.
- Stores a versioned AES-GCM key envelope instead of raw private-key material.
- Restores the exact 32-byte Nostr key from a 24-word Recovery Code.
- Links the same identity to another device through a five-minute QR request, fresh source approval, and a new local Passkey envelope.
- Opens signed invitations from URL fragments, keeping tokens out of HTTP requests and `Referer` headers.

## Identity custody

Persistent profiles require a user-verified platform Passkey with WebAuthn PRF support. The PRF output is expanded with HKDF and used to protect the local key envelope. AURA fails closed when that capability is unavailable; it does not silently substitute exportable browser storage.

The Recovery Code is a reversible 256-bit entropy encoding of the exact Nostr secret key. It is not NIP-06 derivation.

## Message semantics

AURA distinguishes:

- encrypted and persisted locally;
- queued or publishing;
- accepted by at least one intended recipient relay;
- explicitly rejected;
- waiting for retry.

A relay acknowledgement is not presented as recipient delivery.

## Development

Requirements:

- [Bun](https://bun.sh/)
- Chromium installed by Playwright for browser tests

```bash
bun install --frozen-lockfile
bunx playwright install chromium
bun run check
bun run test:unit
bun run build
bun run test:e2e
```

Run locally:

```bash
bun run dev
```

The static production artifact is written to `build/`.

## Security

Please report security issues privately as described in [SECURITY.md](SECURITY.md). Do not open a public issue for a suspected vulnerability.

## License

AURA is licensed under the [GNU Affero General Public License v3.0](LICENSE).
