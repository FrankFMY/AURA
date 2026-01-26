/**
 * Jitsi Service
 *
 * Manages Jitsi Meet video conferencing integration.
 * Uses Jitsi Meet External API for embedding calls.
 */

import { browser } from '$app/environment';

// Jitsi API script URL
const JITSI_API_SCRIPT = 'https://meet.jit.si/external_api.js';

/** Jitsi config options */
export interface JitsiConfig {
	roomName: string;
	displayName: string;
	email?: string;
	avatarUrl?: string;
	startWithAudioMuted?: boolean;
	startWithVideoMuted?: boolean;
	parentNode: HTMLElement;
	onReadyToClose?: () => void;
	onVideoConferenceJoined?: (data: { roomName: string; id: string; displayName: string }) => void;
	onVideoConferenceLeft?: (data: { roomName: string }) => void;
	onParticipantJoined?: (data: { id: string; displayName: string }) => void;
	onParticipantLeft?: (data: { id: string }) => void;
	onAudioMuteStatusChanged?: (data: { muted: boolean }) => void;
	onVideoMuteStatusChanged?: (data: { muted: boolean }) => void;
}

/** Jitsi external API interface */
interface JitsiMeetExternalAPI {
	dispose: () => void;
	executeCommand: (command: string, ...args: unknown[]) => void;
	addListener: (event: string, callback: (...args: unknown[]) => void) => void;
	removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
	isAudioMuted: () => Promise<boolean>;
	isVideoMuted: () => Promise<boolean>;
	getParticipantsInfo: () => Promise<Array<{ displayName: string; participantId: string }>>;
}

// Global Jitsi API type declaration
declare global {
	interface Window {
		JitsiMeetExternalAPI: new (domain: string, options: Record<string, unknown>) => JitsiMeetExternalAPI;
	}
}

/** Jitsi service class */
class JitsiService {
	private api: JitsiMeetExternalAPI | null = null;
	private isApiLoaded = false;
	private loadPromise: Promise<void> | null = null;

	/** Load Jitsi API script */
	async loadApi(): Promise<void> {
		if (!browser) return;
		if (this.isApiLoaded) return;
		if (this.loadPromise) return this.loadPromise;

		this.loadPromise = new Promise((resolve, reject) => {
			// Check if already loaded
			if (window.JitsiMeetExternalAPI) {
				this.isApiLoaded = true;
				resolve();
				return;
			}

			const script = document.createElement('script');
			script.src = JITSI_API_SCRIPT;
			script.async = true;

			script.onload = () => {
				this.isApiLoaded = true;
				resolve();
			};

			script.onerror = () => {
				reject(new Error('Failed to load Jitsi API'));
			};

			document.head.appendChild(script);
		});

		return this.loadPromise;
	}

	/** Initialize Jitsi call */
	async initCall(config: JitsiConfig): Promise<void> {
		if (!browser) {
			throw new Error('Jitsi is only available in browser');
		}

		// Ensure API is loaded
		await this.loadApi();

		// Dispose existing call
		if (this.api) {
			this.dispose();
		}

		const options = {
			roomName: config.roomName,
			parentNode: config.parentNode,
			userInfo: {
				displayName: config.displayName,
				email: config.email || ''
			},
			configOverwrite: {
				startWithAudioMuted: config.startWithAudioMuted ?? false,
				startWithVideoMuted: config.startWithVideoMuted ?? false,
				prejoinPageEnabled: false,
				disableDeepLinking: true,
				disableInviteFunctions: true,
				enableWelcomePage: false,
				enableClosePage: false,
				disableThirdPartyRequests: true,
				analytics: {
					disabled: true
				}
			},
			interfaceConfigOverwrite: {
				TOOLBAR_BUTTONS: [
					'microphone',
					'camera',
					'closedcaptions',
					'desktop',
					'fullscreen',
					'fodeviceselection',
					'hangup',
					'chat',
					'settings',
					'videoquality',
					'filmstrip',
					'tileview'
				],
				SHOW_JITSI_WATERMARK: false,
				SHOW_WATERMARK_FOR_GUESTS: false,
				SHOW_BRAND_WATERMARK: false,
				BRAND_WATERMARK_LINK: '',
				SHOW_POWERED_BY: false,
				SHOW_PROMOTIONAL_CLOSE_PAGE: false,
				DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
				MOBILE_APP_PROMO: false,
				HIDE_INVITE_MORE_HEADER: true,
				DISABLE_PRESENCE_STATUS: false
			}
		};

		this.api = new window.JitsiMeetExternalAPI('meet.jit.si', options);

		// Set avatar if provided
		if (config.avatarUrl) {
			this.api.executeCommand('avatarUrl', config.avatarUrl);
		}

		// Set up event listeners
		if (config.onReadyToClose) {
			this.api.addListener('readyToClose', config.onReadyToClose);
		}

		if (config.onVideoConferenceJoined) {
			this.api.addListener('videoConferenceJoined', config.onVideoConferenceJoined as (...args: unknown[]) => void);
		}

		if (config.onVideoConferenceLeft) {
			this.api.addListener('videoConferenceLeft', config.onVideoConferenceLeft as (...args: unknown[]) => void);
		}

		if (config.onParticipantJoined) {
			this.api.addListener('participantJoined', config.onParticipantJoined as (...args: unknown[]) => void);
		}

		if (config.onParticipantLeft) {
			this.api.addListener('participantLeft', config.onParticipantLeft as (...args: unknown[]) => void);
		}

		if (config.onAudioMuteStatusChanged) {
			this.api.addListener('audioMuteStatusChanged', config.onAudioMuteStatusChanged as (...args: unknown[]) => void);
		}

		if (config.onVideoMuteStatusChanged) {
			this.api.addListener('videoMuteStatusChanged', config.onVideoMuteStatusChanged as (...args: unknown[]) => void);
		}
	}

	/** Toggle audio mute */
	toggleAudio(): void {
		if (this.api) {
			this.api.executeCommand('toggleAudio');
		}
	}

	/** Toggle video */
	toggleVideo(): void {
		if (this.api) {
			this.api.executeCommand('toggleVideo');
		}
	}

	/** Set audio mute state */
	setAudioMuted(muted: boolean): void {
		if (this.api) {
			this.api.executeCommand('toggleAudio');
		}
	}

	/** Set video mute state */
	setVideoMuted(muted: boolean): void {
		if (this.api) {
			this.api.executeCommand('toggleVideo');
		}
	}

	/** End the call */
	hangup(): void {
		if (this.api) {
			this.api.executeCommand('hangup');
		}
	}

	/** Toggle screen sharing */
	toggleShareScreen(): void {
		if (this.api) {
			this.api.executeCommand('toggleShareScreen');
		}
	}

	/** Toggle fullscreen */
	toggleFullscreen(): void {
		if (this.api) {
			this.api.executeCommand('toggleFilmStrip');
		}
	}

	/** Toggle chat */
	toggleChat(): void {
		if (this.api) {
			this.api.executeCommand('toggleChat');
		}
	}

	/** Get audio mute status */
	async isAudioMuted(): Promise<boolean> {
		if (!this.api) return false;
		return this.api.isAudioMuted();
	}

	/** Get video mute status */
	async isVideoMuted(): Promise<boolean> {
		if (!this.api) return false;
		return this.api.isVideoMuted();
	}

	/** Get participants */
	async getParticipants(): Promise<Array<{ displayName: string; participantId: string }>> {
		if (!this.api) return [];
		return this.api.getParticipantsInfo();
	}

	/** Dispose Jitsi instance */
	dispose(): void {
		if (this.api) {
			this.api.dispose();
			this.api = null;
		}
	}

	/** Check if call is active */
	get isActive(): boolean {
		return this.api !== null;
	}
}

/** Jitsi service singleton */
export const jitsiService = new JitsiService();

export default jitsiService;
