<div align="center">

# ✨ AURA

### *Decentralized Social Messenger for the Free World*

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Nostr](https://img.shields.io/badge/Protocol-Nostr-purple.svg)](https://nostr.com)
[![SvelteKit](https://img.shields.io/badge/Built%20with-SvelteKit-orange.svg)](https://kit.svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<br />

<img src="static/favicon.svg" alt="AURA Logo" width="120" height="120" />

<br />

**AURA** is a censorship-resistant social messenger built on the [Nostr](https://nostr.com) protocol.  
It empowers people to communicate freely, without fear of surveillance or censorship.

*Because freedom of speech is a human right, not a privilege.*

[**🚀 Live Demo**](https://aura-nostr.vercel.app) · [**📖 Documentation**](#documentation) · [**🐛 Report Bug**](https://github.com/FrankFMY/AURA/issues) · [**💡 Request Feature**](https://github.com/FrankFMY/AURA/issues)

</div>

---

## 🌟 Why AURA?

In a world where social platforms control what you see, who you can reach, and what you can say — **AURA** offers an alternative. Built on the Nostr protocol, AURA is:

- 🔓 **Truly Decentralized** — No single company controls your data or can ban you
- 🛡️ **Censorship Resistant** — Your voice cannot be silenced by any authority
- 🔐 **Privacy First** — End-to-end encrypted direct messages (NIP-17 Gift Wraps)
- ⚡ **Lightning Integrated** — Send and receive Bitcoin payments via NWC
- 💰 **eCash Support** — Anonymous payments with Cashu tokens
- 🛒 **Decentralized Marketplace** — Buy and sell with Bitcoin (NIP-15)
- 🤖 **AI Chat** — Decentralized AI via Data Vending Machines (NIP-90)
- 🌍 **Open Source** — Transparent, auditable, and community-driven
- 📱 **Mobile Ready** — PWA + Capacitor for native Android/iOS builds

> *"They can't stop the signal."*

---

## ✨ Features

### 🏠 Social Feed
- Global and personalized feeds
- Real-time updates via WebSocket subscriptions
- Infinite scroll with optimistic UI updates
- Create posts, reply, repost, and react

### 💬 Private Messaging
- End-to-end encrypted DMs with NIP-17 Gift Wraps (metadata hidden)
- Legacy NIP-04 support for backwards compatibility
- Conversation list with unread indicators
- Real-time message delivery with offline queue
- Send eCash (Cashu tokens) in messages

### 👤 Profiles
- View and edit your Nostr profile
- Follow/unfollow users
- Contact list management (NIP-02)
- Verified user badges (NIP-05)

### 💰 Lightning Wallet & eCash
- Nostr Wallet Connect (NWC) integration
- Cashu eCash for anonymous payments
- Send and receive Bitcoin via Lightning
- Swap between Lightning ⇄ eCash
- Transaction history
- ⚡ Zap support for posts and users (NIP-57)

### 🛒 Marketplace (NIP-15)
- Browse decentralized product listings
- Filter by category, price, condition
- Web of Trust integration for seller reputation
- Direct messaging with sellers
- Pay with Lightning or eCash

### 🤖 AI Chat (NIP-90)
- Decentralized AI via Data Vending Machines
- Pay-per-use with Lightning sats
- Text generation, translation, summarization
- No accounts, no tracking

### 🔍 Advanced Search
- Search notes by content
- Find users by name or npub
- Discover hashtags with #tag filters
- Advanced filters (date range, author, content type)
- Search history and saved searches
- Trending topics

### 👥 Group Chats (NIP-28)
- Public channels for communities
- Real-time group messaging
- Create and join groups
- Member management
- Reply threading

### 📞 Video/Audio Calls
- One-on-one video calls via Jitsi
- Voice calls support
- Call invite via DM
- In-call controls (mute, video toggle, screen share)
- Call history

### 📖 Stories (24h Ephemeral Posts)
- Create image/text stories
- Stories bar with avatars
- Full-screen story viewer
- Auto-delete after 24 hours
- View tracking

### 📊 Polls
- Create polls with 2-4 options
- Vote on polls
- Real-time results
- Optional end time

### 🔖 Bookmarks (NIP-51)
- Save posts for later
- Private bookmark list
- Quick access from sidebar

### 🎤 Voice Messages
- Hold-to-record in DMs
- Waveform visualization
- Play/pause controls
- Upload via Blossom

### 🔔 Push Notifications
- Web Push API support
- Notification settings (mentions, DMs, zaps)
- Service Worker integration

### 📱 QR Code Profile
- Generate profile QR code
- Share nostr:npub URI
- Downloadable image

### ⚙️ Settings
- Relay management
- Theme customization (light/dark)
- Language selection (EN, ES, RU, ZH)
- Data export and cache management

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | [SvelteKit 2](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) |
| **Language** | [TypeScript](https://www.typescriptlang.org) (strict mode) |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com) |
| **Nostr** | [NDK](https://github.com/nostr-dev-kit/ndk) (Nostr Dev Kit) |
| **Database** | [Dexie.js](https://dexie.org) (IndexedDB wrapper) |
| **Crypto** | [@noble](https://github.com/paulmillr/noble-curves) libraries |
| **Testing** | [Vitest](https://vitest.dev) + [Playwright](https://playwright.dev) |
| **Mobile** | [Capacitor](https://capacitorjs.com) |
| **eCash** | [Cashu-TS](https://github.com/cashubtc/cashu-ts) |
| **Icons** | [Lucide](https://lucide.dev) |
| **Validation** | [Zod](https://zod.dev) |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) >= 18.0.0
- [Bun](https://bun.sh) (recommended) or npm/yarn/pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/FrankFMY/AURA.git
cd AURA

# Install dependencies
bun install

# Start development server
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
# Create production build
bun run build

# Preview production build
bun run preview
```

---

## 📖 Documentation

### Project Structure

```
AURA/
├── src/
│   ├── lib/
│   │   ├── components/     # Reusable UI components
│   │   │   ├── bookmarks/  # Bookmark button
│   │   │   ├── calls/      # Video/audio calls UI
│   │   │   ├── cashu/      # eCash components
│   │   │   ├── feed/       # Feed-related components
│   │   │   ├── groups/     # Group chat components
│   │   │   ├── media/      # Media upload (Blossom)
│   │   │   ├── messages/   # Voice messages
│   │   │   ├── notifications/
│   │   │   ├── polls/      # Poll creation & voting
│   │   │   ├── profile/    # Profile QR code
│   │   │   ├── stories/    # Stories bar & viewer
│   │   │   ├── verified/   # NIP-05 verification
│   │   │   ├── wot/        # Web of Trust components
│   │   │   └── ui/         # Base UI components
│   │   ├── core/           # Core utilities (errors, resilience)
│   │   ├── db/             # Dexie.js database
│   │   ├── i18n/           # Internationalization
│   │   ├── services/       # Business logic services
│   │   │   ├── blossom/    # Decentralized file storage
│   │   │   ├── calls/      # Jitsi video calls
│   │   │   ├── crypto/     # Encryption (NIP-44, Gift Wrap)
│   │   │   ├── dvm/        # Data Vending Machines (AI)
│   │   │   ├── ndk/        # NDK service modules
│   │   │   ├── nip05/      # NIP-05 verification
│   │   │   └── wallet/     # NWC + Cashu eCash
│   │   ├── stores/         # Svelte 5 runes stores
│   │   ├── utils/          # Utility functions
│   │   └── validators/     # Zod schemas & sanitization
│   ├── routes/             # SvelteKit routes
│   │   ├── ai/             # AI Chat page
│   │   ├── bookmarks/      # Saved posts
│   │   ├── call/           # Video/audio call page
│   │   ├── groups/         # Group chats
│   │   ├── marketplace/    # NIP-15 Marketplace
│   │   └── ...
│   └── app.css             # Global styles
├── static/                 # Static assets
├── tests/                  # Test files (646+ tests)
│   ├── e2e/                # Playwright E2E tests
│   └── unit/               # Vitest unit tests
├── android/                # Capacitor Android (generated)
└── ...config files
```

### Nostr NIPs Implemented

| NIP | Description | Status |
|-----|-------------|--------|
| NIP-01 | Basic protocol | ✅ |
| NIP-02 | Contact List | ✅ |
| NIP-04 | Encrypted DMs (legacy) | ✅ |
| NIP-05 | DNS Verification | ✅ |
| NIP-07 | Browser Extension | ✅ |
| NIP-10 | Replies & Threading | ✅ |
| NIP-15 | Marketplace Listings | ✅ |
| NIP-17 | Gift Wraps (Private DMs) | ✅ |
| NIP-18 | Reposts | ✅ |
| NIP-25 | Reactions | ✅ |
| NIP-44 | Versioned Encryption | ✅ |
| NIP-47 | Nostr Wallet Connect | ✅ |
| NIP-57 | Lightning Zaps | ✅ |
| NIP-59 | Gift Wrap Protocol | ✅ |
| NIP-90 | Data Vending Machines (AI) | ✅ |
| NIP-98 | HTTP Auth (Blossom) | ✅ |
| NIP-28 | Public Channels (Groups) | ✅ |
| NIP-51 | Lists (Bookmarks) | ✅ |

### Available Scripts

```bash
bun run dev          # Start development server
bun run build        # Build for production
bun run preview      # Preview production build
bun run check        # Type-check with svelte-check
bun run test         # Run unit tests
bun run test:e2e     # Run E2E tests
bun run test:coverage # Run tests with coverage
```

---

## 🌐 Deployment

### Vercel (Recommended)

AURA is optimized for deployment on Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/FrankFMY/AURA)

### GitHub Pages

AURA can also be deployed to GitHub Pages using the included workflow.

### IPFS (Censorship Resistant)

For maximum censorship resistance, deploy AURA to IPFS:

```bash
# Using Pinata (set PINATA_API_KEY and PINATA_API_SECRET first)
bun run deploy:ipfs --provider pinata

# Using local IPFS node
bun run deploy:ipfs --provider local
```

Once deployed, access AURA via any IPFS gateway:
- `https://ipfs.io/ipfs/<CID>`
- `https://dweb.link/ipfs/<CID>`
- `https://cloudflare-ipfs.com/ipfs/<CID>`

### 📱 Mobile Build (Android/iOS)

AURA uses Capacitor for native mobile builds:

```bash
# Build web assets
bun run build

# Add Android platform (first time only)
bunx cap add android

# Sync web assets to native
bunx cap sync android

# Open in Android Studio
bunx cap open android
```

**Build APK in Android Studio:**
1. Open Android Studio
2. Build > Build Bundle(s) / APK(s) > Build APK(s)
3. APK location: `android/app/build/outputs/apk/`

**Requirements:**
- Android Studio with Android SDK
- For release builds: signing key

---

## 🤝 Contributing

Contributions are what make the open source community amazing! Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 🔒 Security

AURA takes security seriously. If you discover a security vulnerability, please report it responsibly:

- **Email**: Pryanishnikovartem@gmail.com
- **Subject**: [SECURITY] AURA Vulnerability Report

Please do **not** create public issues for security vulnerabilities.

See [SECURITY.md](SECURITY.md) for our security policy.

---

## 📜 License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.

This means you can:
- ✅ Use it commercially
- ✅ Modify it freely
- ✅ Distribute it
- ✅ Use it privately
- ✅ Patent protection included

---

## ⚖️ Legal Disclaimer

**AURA is a client-side interface for the Nostr protocol.** We do not host, store, or control any user content. All cryptographic keys are stored locally on the user's device. Content displayed in AURA is fetched from decentralized relays operated by independent third parties.

The developers of AURA:
- Do not have access to user private keys or messages
- Cannot modify or delete content published by users
- Are not responsible for content published on the Nostr network
- Cannot comply with takedown requests as we do not host content

For concerns about specific content, please contact the relay operators directly.

---

## 💜 Support the Project

If AURA has helped you, consider supporting its development:

### ⚡ Bitcoin (Lightning Network)
```
classywallaby932694@getalby.com
```

### 🟣 Solana
```
DANryD6MxNr3BQcYZN3rao9qM4VzS2sx7sHy944emPH2
```

### 🔷 Ethereum / EVM
```
0xC2335f06ab8Ef2512375bB8Cd2c07A7Bd1589A6e
```

### 🌟 Other Ways to Help
- ⭐ Star this repository
- 🐛 Report bugs and suggest features
- 📝 Improve documentation
- 🌍 Help with translations
- 📢 Spread the word about Nostr and AURA

---

## 👨‍💻 Author

<div align="center">

**Artem Pryanishnikov**

*Creator & Lead Developer*

[![GitHub](https://img.shields.io/badge/GitHub-FrankFMY-181717?style=for-the-badge&logo=github)](https://github.com/FrankFMY)
[![Telegram](https://img.shields.io/badge/Telegram-@FrankFMY-26A5E4?style=for-the-badge&logo=telegram)](https://t.me/FrankFMY)
[![Email](https://img.shields.io/badge/Email-Contact-EA4335?style=for-the-badge&logo=gmail)](mailto:Pryanishnikovartem@gmail.com)

</div>

---

## 🙏 Acknowledgments

- [Nostr Protocol](https://nostr.com) — For creating a truly decentralized protocol
- [NDK](https://github.com/nostr-dev-kit/ndk) — For the excellent Nostr development kit
- [Svelte](https://svelte.dev) — For the amazing framework
- [All Contributors](https://github.com/FrankFMY/AURA/graphs/contributors) — Who help make this project better

---

<div align="center">

### *"Information wants to be free"*

<br />

**Built with 💜 for a free and open internet**

<br />

If you believe in freedom of speech and decentralization,  
please consider starring ⭐ this repository and sharing AURA with others.

<br />

*Together, we can build a better, freer world.*

</div>
