# Contributing to AURA

First off, thank you for considering contributing to AURA! 🎉

It's people like you who make AURA such a great tool for freedom and privacy. This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Style Guidelines](#style-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/AURA.git
   cd AURA
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/FrankFMY/AURA.git
   ```
4. **Install dependencies**:
   ```bash
   bun install
   ```

## How Can I Contribute?

### 🐛 Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **Environment info** (browser, OS, etc.)

### 💡 Suggesting Features

Feature suggestions are welcome! Please:

- Check if the feature has already been suggested
- Provide a clear use case
- Explain why this feature would benefit users
- Consider if it aligns with AURA's mission of privacy and decentralization

### 🔧 Code Contributions

1. Look for issues labeled `good first issue` or `help wanted`
2. Comment on the issue to let others know you're working on it
3. Follow the development setup guide below

### 📝 Documentation

Documentation improvements are always welcome:

- Fix typos and grammar
- Add examples and tutorials
- Improve code comments
- Translate documentation

### 🌍 Translations

Help make AURA accessible to more people:

- Add new language files in `src/lib/i18n/locales/`
- Follow the existing structure in `en.json`
- Submit a PR with your translation

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- Bun (recommended) or npm/yarn

### Setup

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run type checking
bun run check

# Run tests
bun run test

# Run E2E tests
bun run test:e2e
```

### Project Structure

```
src/
├── lib/
│   ├── components/     # UI components
│   ├── core/           # Core utilities
│   ├── db/             # Database layer
│   ├── i18n/           # Internationalization
│   ├── services/       # Business logic
│   ├── stores/         # State management
│   ├── utils/          # Utilities
│   └── validators/     # Validation schemas
└── routes/             # SvelteKit routes
```

## Style Guidelines

### TypeScript

- Use strict mode (`strict: true`)
- Avoid `any` — prefer `unknown` for unknown types
- Define explicit interfaces/types
- Use meaningful variable names

```typescript
// Good
interface UserProfile {
  pubkey: string;
  name?: string;
  picture?: string;
}

// Bad
const data: any = fetchUser();
```

### Svelte 5

- Use runes (`$state`, `$derived`, `$effect`) for reactivity
- Prefer `$props()` over the legacy `export let`
- Keep components focused and composable

```svelte
<script lang="ts">
  interface Props {
    title: string;
    onClick?: () => void;
  }
  
  let { title, onClick }: Props = $props();
  let count = $state(0);
</script>
```

### CSS/Tailwind

- Use Tailwind CSS utilities
- Follow mobile-first responsive design
- Use CSS variables for theming
- Prefer semantic class names for complex components

### Code Quality

- Follow KISS (Keep It Simple, Stupid)
- Follow DRY (Don't Repeat Yourself)
- Write self-documenting code
- Add comments for complex logic only

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding/updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(feed): add infinite scroll to global feed
fix(messages): resolve decryption error for NIP-44
docs(readme): update installation instructions
refactor(auth): simplify login flow
```

## Pull Request Process

1. **Update your fork**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** and commit them

4. **Run checks**:
   ```bash
   bun run check
   bun run test
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** with:
   - Clear title and description
   - Reference to related issues
   - Screenshots for UI changes

7. **Address review feedback** promptly

### PR Checklist

- [ ] Code follows the style guidelines
- [ ] Self-review of the code performed
- [ ] Comments added for complex code
- [ ] Documentation updated if needed
- [ ] No new warnings introduced
- [ ] Tests added/updated as appropriate
- [ ] All tests pass locally

## Questions?

Feel free to:

- Open a [Discussion](https://github.com/FrankFMY/AURA/discussions)
- Contact the maintainer on [Telegram](https://t.me/FrankFMY)
- Email: Pryanishnikovartem@gmail.com

---

Thank you for contributing to AURA! Together, we're building a freer internet. 💜
