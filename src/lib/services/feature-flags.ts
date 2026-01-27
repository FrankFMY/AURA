/**
 * Feature Flags Service
 * 
 * Enables/disables features dynamically without code changes.
 * Supports local overrides, user-based targeting, and percentage rollouts.
 */

import { browser } from '$app/environment';

/** Feature flag definition */
export interface FeatureFlag {
	/** Unique identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of the feature */
	description: string;
	/** Default enabled state */
	defaultEnabled: boolean;
	/** Percentage of users to enable (0-100) */
	rolloutPercentage?: number;
	/** Specific pubkeys to enable for */
	enabledForPubkeys?: string[];
	/** Environment restrictions */
	environments?: ('development' | 'staging' | 'production')[];
}

/** All available feature flags */
export const FEATURE_FLAGS: Record<string, FeatureFlag> = {
	NIP44_ENCRYPTION: {
		id: 'NIP44_ENCRYPTION',
		name: 'NIP-44 Encryption',
		description: 'Use NIP-44 encryption for direct messages instead of NIP-04',
		defaultEnabled: true
	},
	WALLET_INTEGRATION: {
		id: 'WALLET_INTEGRATION',
		name: 'Wallet Integration',
		description: 'Enable Lightning wallet features via NWC',
		defaultEnabled: true
	},
	VIRTUAL_SCROLLING: {
		id: 'VIRTUAL_SCROLLING',
		name: 'Virtual Scrolling',
		description: 'Use virtual scrolling for long lists',
		defaultEnabled: true
	},
	OFFLINE_MODE: {
		id: 'OFFLINE_MODE',
		name: 'Offline Mode',
		description: 'Enable offline-first functionality with background sync',
		defaultEnabled: true
	},
	PUSH_NOTIFICATIONS: {
		id: 'PUSH_NOTIFICATIONS',
		name: 'Push Notifications',
		description: 'Enable push notifications for new messages and mentions',
		defaultEnabled: false,
		environments: ['production']
	},
	ANALYTICS: {
		id: 'ANALYTICS',
		name: 'Analytics',
		description: 'Enable privacy-respecting analytics',
		defaultEnabled: false
	},
	EXPERIMENTAL_UI: {
		id: 'EXPERIMENTAL_UI',
		name: 'Experimental UI',
		description: 'Enable experimental UI features',
		defaultEnabled: false,
		rolloutPercentage: 10
	},
	ZAPS: {
		id: 'ZAPS',
		name: 'Zaps',
		description: 'Enable Lightning zaps on notes',
		defaultEnabled: true
	},
	MEDIA_UPLOADS: {
		id: 'MEDIA_UPLOADS',
		name: 'Media Uploads',
		description: 'Enable media upload functionality',
		defaultEnabled: false,
		environments: ['development', 'staging']
	},
	REACTIONS: {
		id: 'REACTIONS',
		name: 'Reactions',
		description: 'Enable emoji reactions on notes',
		defaultEnabled: true
	}
};

/** Local storage key for feature flag overrides */
const OVERRIDES_KEY = 'aura-feature-flags';

/** Get current environment */
function getEnvironment(): 'development' | 'staging' | 'production' {
	if (!browser) return 'production';
	
	const hostname = window.location.hostname;
	if (hostname === 'localhost' || hostname === '127.0.0.1') {
		return 'development';
	}
	if (hostname.includes('staging') || hostname.includes('preview')) {
		return 'staging';
	}
	return 'production';
}

/** Generate a consistent hash for percentage rollouts */
function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

class FeatureFlagsService {
	private overrides: Map<string, boolean> = new Map();
	private currentPubkey: string | null = null;

	constructor() {
		this.loadOverrides();
	}

	/** Load overrides from local storage */
	private loadOverrides(): void {
		if (!browser) return;

		try {
			const stored = localStorage.getItem(OVERRIDES_KEY);
			if (stored) {
				const parsed = JSON.parse(stored) as Record<string, boolean>;
				this.overrides = new Map(Object.entries(parsed));
			}
		} catch (e) {
			console.warn('Failed to load feature flag overrides:', e);
		}
	}

	/** Save overrides to local storage */
	private saveOverrides(): void {
		if (!browser) return;

		try {
			const obj = Object.fromEntries(this.overrides);
			localStorage.setItem(OVERRIDES_KEY, JSON.stringify(obj));
		} catch (e) {
			console.warn('Failed to save feature flag overrides:', e);
		}
	}

	/** Set the current user's pubkey for targeting */
	public setUser(pubkey: string | null): void {
		this.currentPubkey = pubkey;
	}

	/** Check if a feature is enabled */
	public isEnabled(flagId: string): boolean {
		const flag = FEATURE_FLAGS[flagId];
		if (!flag) {
			console.warn(`Unknown feature flag: ${flagId}`);
			return false;
		}

		// Check local override first
		if (this.overrides.has(flagId)) {
			return this.overrides.get(flagId)!;
		}

		// Check environment restrictions
		if (flag.environments && flag.environments.length > 0) {
			const env = getEnvironment();
			if (!flag.environments.includes(env)) {
				return false;
			}
		}

		// Check pubkey targeting
		if (flag.enabledForPubkeys && this.currentPubkey) {
			if (flag.enabledForPubkeys.includes(this.currentPubkey)) {
				return true;
			}
		}

		// Check percentage rollout
		if (flag.rolloutPercentage !== undefined && this.currentPubkey) {
			const hash = hashString(`${flagId}:${this.currentPubkey}`);
			const percentage = hash % 100;
			if (percentage < flag.rolloutPercentage) {
				return true;
			}
			return false;
		}

		return flag.defaultEnabled;
	}

	/** Set a local override for a feature flag */
	public setOverride(flagId: string, enabled: boolean): void {
		this.overrides.set(flagId, enabled);
		this.saveOverrides();
	}

	/** Clear a local override */
	public clearOverride(flagId: string): void {
		this.overrides.delete(flagId);
		this.saveOverrides();
	}

	/** Clear all local overrides */
	public clearAllOverrides(): void {
		this.overrides.clear();
		this.saveOverrides();
	}

	/** Get all flags with their current states */
	public getAllFlags(): Array<FeatureFlag & { enabled: boolean; hasOverride: boolean }> {
		return Object.values(FEATURE_FLAGS).map(flag => ({
			...flag,
			enabled: this.isEnabled(flag.id),
			hasOverride: this.overrides.has(flag.id)
		}));
	}
}

export const featureFlags = new FeatureFlagsService();

/** Convenience function to check if a feature is enabled */
export function isFeatureEnabled(flagId: string): boolean {
	return featureFlags.isEnabled(flagId);
}

export default featureFlags;
