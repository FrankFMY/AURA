<div align="center">

# ✨ AURA

### *Decentralized Social Messenger for the Free World*

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](https://opensource.org/licenses/MIT)
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
- 🔐 **Privacy First** — End-to-end encrypted direct messages (NIP-44)
- ⚡ **Lightning Integrated** — Send and receive Bitcoin payments via NWC
- 🌍 **Open Source** — Transparent, auditable, and community-driven
- 📱 **PWA Ready** — Install on any device, works offline

> *"They can't stop the signal."*

---

## ✨ Features

### 🏠 Social Feed
- Global and personalized feeds
- Real-time updates via WebSocket subscriptions
- Infinite scroll with optimistic UI updates
- Create posts, reply, repost, and react

### 💬 Private Messaging
- End-to-end encrypted DMs (NIP-04 & NIP-44)
- Conversation list with unread indicators
- Real-time message delivery
- Offline message queue

### 👤 Profiles
- View and edit your Nostr profile
- Follow/unfollow users
- Contact list management (NIP-02)
- Verified user badges (NIP-05)

### 💰 Lightning Wallet
- Nostr Wallet Connect (NWC) integration
- Send and receive Bitcoin payments
- Transaction history
- Zap support (coming soon)

### 🔍 Search
- Search notes by content
- Find users by name or npub
- Discover hashtags
- Trending topics

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
│   │   │   ├── feed/       # Feed-related components
│   │   │   ├── notifications/
│   │   │   └── ui/         # Base UI components
│   │   ├── core/           # Core utilities (errors, resilience)
│   │   ├── db/             # Dexie.js database
│   │   ├── i18n/           # Internationalization
│   │   ├── services/       # Business logic services
│   │   │   ├── crypto/     # Encryption (NIP-44)
│   │   │   ├── ndk/        # NDK service modules
│   │   │   └── wallet/     # NWC client
│   │   ├── stores/         # Svelte 5 runes stores
│   │   ├── utils/          # Utility functions
│   │   └── validators/     # Zod schemas & sanitization
│   ├── routes/             # SvelteKit routes
│   └── app.css             # Global styles
├── static/                 # Static assets
├── tests/                  # Test files
│   ├── e2e/                # Playwright E2E tests
│   └── unit/               # Vitest unit tests
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
| NIP-18 | Reposts | ✅ |
| NIP-25 | Reactions | ✅ |
| NIP-44 | Versioned Encryption | ✅ |
| NIP-47 | Nostr Wallet Connect | ✅ |

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

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

This means you can:
- ✅ Use it commercially
- ✅ Modify it freely
- ✅ Distribute it
- ✅ Use it privately

---

## 💜 Support the Project

If AURA has helped you, consider supporting its development:

### ⚡ Bitcoin (Lightning Network)
```
lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkx6rfwd4k2u3t2yl
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
