/**
 * Push Notifications Service
 *
 * Manages Web Push API subscriptions and notification preferences.
 * Works with the Service Worker for delivering notifications.
 */

import { dbHelpers } from '$db';

/** Notification types that can be enabled/disabled */
export type NotificationType = 'mentions' | 'dms' | 'zaps' | 'replies' | 'followers';

/** Notification settings */
export interface NotificationSettings {
	/** Whether push notifications are enabled globally */
	enabled: boolean;
	/** Individual notification type toggles */
	types: Record<NotificationType, boolean>;
}

/** Default notification settings */
const DEFAULT_SETTINGS: NotificationSettings = {
	enabled: false,
	types: {
		mentions: true,
		dms: true,
		zaps: true,
		replies: true,
		followers: false
	}
};

/** Settings key in IndexedDB */
const SETTINGS_KEY = 'push-notification-settings';

/** Push notifications service */
class PushNotificationsService {
	private settings: NotificationSettings = { ...DEFAULT_SETTINGS };
	private isInitialized = false;

	/**
	 * Check if push notifications are supported
	 */
	isSupported(): boolean {
		return (
			globalThis.window !== undefined &&
			'serviceWorker' in globalThis.navigator &&
			'PushManager' in globalThis.window &&
			'Notification' in globalThis.window
		);
	}

	/**
	 * Get current permission status
	 */
	getPermissionStatus(): NotificationPermission | 'unsupported' {
		if (!this.isSupported()) {
			return 'unsupported';
		}
		return Notification.permission;
	}

	/**
	 * Request notification permission
	 */
	async requestPermission(): Promise<NotificationPermission> {
		if (!this.isSupported()) {
			throw new Error('Push notifications not supported');
		}

		const permission = await Notification.requestPermission();
		return permission;
	}

	/**
	 * Initialize service and load settings
	 */
	async init(): Promise<void> {
		if (this.isInitialized) return;

		try {
			const stored = await dbHelpers.getSetting<NotificationSettings>(
				SETTINGS_KEY,
				undefined
			);

			if (stored) {
				this.settings = {
					...DEFAULT_SETTINGS,
					...stored,
					types: { ...DEFAULT_SETTINGS.types, ...stored.types }
				};
			}

			this.isInitialized = true;
		} catch (e) {
			console.warn('[PushNotifications] Failed to load settings:', e);
			this.isInitialized = true;
		}
	}

	/**
	 * Get current settings
	 */
	getSettings(): NotificationSettings {
		return { ...this.settings };
	}

	/**
	 * Check if notifications are enabled
	 */
	isEnabled(): boolean {
		return this.settings.enabled && Notification.permission === 'granted';
	}

	/**
	 * Check if a specific notification type is enabled
	 */
	isTypeEnabled(type: NotificationType): boolean {
		return this.isEnabled() && this.settings.types[type];
	}

	/**
	 * Enable push notifications
	 */
	async enable(): Promise<boolean> {
		if (!this.isSupported()) {
			return false;
		}

		// Request permission if not already granted
		if (Notification.permission !== 'granted') {
			const permission = await this.requestPermission();
			if (permission !== 'granted') {
				return false;
			}
		}

		this.settings.enabled = true;
		await this.saveSettings();

		return true;
	}

	/**
	 * Disable push notifications
	 */
	async disable(): Promise<void> {
		this.settings.enabled = false;
		await this.saveSettings();
	}

	/**
	 * Toggle a notification type
	 */
	async toggleType(type: NotificationType, enabled: boolean): Promise<void> {
		this.settings.types[type] = enabled;
		await this.saveSettings();
	}

	/**
	 * Update all settings
	 */
	async updateSettings(settings: Partial<NotificationSettings>): Promise<void> {
		if (settings.enabled !== undefined) {
			this.settings.enabled = settings.enabled;
		}
		if (settings.types) {
			this.settings.types = { ...this.settings.types, ...settings.types };
		}
		await this.saveSettings();
	}

	/**
	 * Save settings to IndexedDB
	 */
	private async saveSettings(): Promise<void> {
		try {
			await dbHelpers.setSetting(SETTINGS_KEY, this.settings);
		} catch (e) {
			console.error('[PushNotifications] Failed to save settings:', e);
		}
	}

	/**
	 * Show a local notification (for in-app events)
	 */
	async showNotification(
		title: string,
		options: {
			body?: string;
			icon?: string;
			badge?: string;
			url?: string;
			tag?: string;
			type?: NotificationType;
		} = {}
	): Promise<void> {
		// Check if this type is enabled
		if (options.type && !this.isTypeEnabled(options.type)) {
			return;
		}

		// Check general permission
		if (!this.isEnabled()) {
			return;
		}

		try {
			const registration = await navigator.serviceWorker.ready;

			await registration.showNotification(title, {
				body: options.body,
				icon: options.icon || '/icon-192.svg',
				badge: options.badge || '/icon-192.svg',
				tag: options.tag,
				data: {
					url: options.url || '/'
				}
			} as NotificationOptions);
		} catch (e) {
			console.error('[PushNotifications] Failed to show notification:', e);
		}
	}

	/**
	 * Show notification for a mention
	 */
	async notifyMention(authorName: string, content: string, eventId: string): Promise<void> {
		await this.showNotification(`${authorName} mentioned you`, {
			body: content.slice(0, 100),
			url: `/note/${eventId}`,
			tag: `mention-${eventId}`,
			type: 'mentions'
		});
	}

	/**
	 * Show notification for a DM
	 */
	async notifyDM(authorName: string, preview: string, pubkey: string): Promise<void> {
		await this.showNotification(`New message from ${authorName}`, {
			body: preview.slice(0, 50) + '...',
			url: `/messages?start=${pubkey}`,
			tag: `dm-${pubkey}`,
			type: 'dms'
		});
	}

	/**
	 * Show notification for a zap
	 */
	async notifyZap(authorName: string, amount: number, eventId?: string): Promise<void> {
		await this.showNotification(`${authorName} zapped you ⚡`, {
			body: `${amount.toLocaleString()} sats`,
			url: eventId ? `/note/${eventId}` : '/wallet',
			tag: `zap-${Date.now()}`,
			type: 'zaps'
		});
	}

	/**
	 * Show notification for a reply
	 */
	async notifyReply(authorName: string, content: string, eventId: string): Promise<void> {
		await this.showNotification(`${authorName} replied`, {
			body: content.slice(0, 100),
			url: `/note/${eventId}`,
			tag: `reply-${eventId}`,
			type: 'replies'
		});
	}

	/**
	 * Show notification for a new follower
	 */
	async notifyNewFollower(authorName: string, pubkey: string): Promise<void> {
		await this.showNotification(`${authorName} followed you`, {
			body: 'You have a new follower!',
			url: `/profile/${pubkey}`,
			tag: `follower-${pubkey}`,
			type: 'followers'
		});
	}
}

/** Singleton instance */
export const pushNotifications = new PushNotificationsService();

export default pushNotifications;
