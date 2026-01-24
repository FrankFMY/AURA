import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aura.app',
  appName: 'AURA',
  webDir: 'build',
  server: {
    // Enable HTTPS for secure websocket connections
    androidScheme: 'https',
    // Allow navigation to external URLs
    allowNavigation: ['*.nostr.band', '*.damus.io', '*.nos.lol']
  },
  plugins: {
    // Keyboard plugin for better mobile UX
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    },
    // Status bar styling
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0f'
    },
    // Splash screen
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0f',
      showSpinner: false
    }
  },
  android: {
    // Allow mixed content (HTTP on HTTPS)
    allowMixedContent: true,
    // Enable WebView debugging in dev
    webContentsDebuggingEnabled: true
  },
  ios: {
    // iOS specific settings
    contentInset: 'automatic',
    scrollEnabled: true
  }
};

export default config;
