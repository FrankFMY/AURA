# Contributing

Thanks for helping improve AURA.

## Before opening a change

1. Keep the product focused on private one-to-one messaging.
2. Do not add automatic NIP-04 fallback, social feeds, wallets, analytics, trackers, or remote fonts.
3. Preserve fail-closed identity custody and kind-`10050` routing.
4. Add a failing test before changing security, storage, protocol, or delivery behavior.

## Quality gate

```bash
bun install --frozen-lockfile
bun run check
bun run test:unit
bun run build
bun run test:e2e
bun audit
```

Use clear commits without generated attribution trailers. Never commit private keys, Recovery Codes, `.env` files, local audits, test traces, or deployment credentials.

Security reports belong in the private channel documented in [SECURITY.md](SECURITY.md), not in public issues.
