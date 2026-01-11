# Security Policy

## Our Commitment

AURA is built with security and privacy as core principles. We take the security of our users seriously and appreciate the community's efforts in identifying and reporting vulnerabilities.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in AURA, please report it responsibly.

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Email your findings to: **Pryanishnikovartem@gmail.com**
3. Use the subject line: `[SECURITY] AURA Vulnerability Report`

### What to Include

Please provide as much information as possible:

- Type of vulnerability (e.g., XSS, CSRF, injection, etc.)
- Full path to the vulnerable component
- Step-by-step instructions to reproduce
- Proof-of-concept code (if applicable)
- Potential impact of the vulnerability
- Any suggested fixes (optional)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days (depending on severity)

### What to Expect

1. **Acknowledgment**: We'll confirm receipt of your report
2. **Assessment**: We'll investigate and assess the vulnerability
3. **Updates**: We'll keep you informed of our progress
4. **Resolution**: We'll work on a fix and coordinate disclosure
5. **Credit**: We'll publicly acknowledge your contribution (if desired)

## Security Best Practices for Users

### Key Management

- **Never share your private key** with anyone
- Use a **Nostr browser extension** (NIP-07) when possible — your keys never leave your device
- If you must use a private key directly, ensure you're on a secure, private network
- Consider using a **hardware wallet** for high-value accounts

### Relay Security

- Be cautious about which relays you connect to
- Avoid relays that require authentication with your private key
- Review relay policies before connecting

### General Security

- Keep your browser and extensions updated
- Be wary of phishing attempts — always verify URLs
- Enable 2FA on any accounts related to your Nostr identity
- Regularly review your connected applications

## Known Security Considerations

### Client-Side Encryption

AURA implements NIP-44 for encrypted direct messages. Key points:

- Messages are encrypted client-side before being sent
- Only the sender and recipient can decrypt messages
- Relay operators cannot read encrypted content

### Local Storage

- Keys may be stored in the browser's localStorage
- This is convenient but less secure than browser extensions
- We recommend using NIP-07 extensions for enhanced security

### Content Security Policy

AURA implements a strict CSP to prevent:

- Cross-site scripting (XSS)
- Data injection attacks
- Clickjacking

### Dependencies

We regularly audit our dependencies for known vulnerabilities. Our key cryptographic dependencies are from the audited `@noble` library family.

## Security Features

### Implemented

- [x] Content Security Policy (CSP)
- [x] XSS protection via DOMPurify
- [x] HTTPS-only external resources
- [x] NIP-44 encrypted DMs
- [x] NIP-07 browser extension support
- [x] Input validation with Zod schemas
- [x] No server-side data storage

### Planned

- [ ] Subresource Integrity (SRI) for CDN assets
- [ ] Security audit by third party
- [ ] Bug bounty program

## Security Updates

Security updates will be released as soon as possible after a vulnerability is confirmed. We recommend:

1. **Watching** this repository for updates
2. **Enabling notifications** for security advisories
3. **Updating** to the latest version promptly

## Acknowledgments

We thank the following individuals for responsibly disclosing security issues:

*No reports yet — be the first!*

---

## Contact

**Security Contact**: Pryanishnikovartem@gmail.com  
**General Contact**: [@FrankFMY](https://t.me/FrankFMY)

Thank you for helping keep AURA and its users safe! 🛡️
