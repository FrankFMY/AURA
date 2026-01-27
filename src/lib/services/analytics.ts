/**
 * Privacy-Respecting Analytics Service
 * 
 * Collects anonymous usage data to improve the application.
 * - No personal data collected
 * - No tracking across sessions
 * - All data is aggregated
 * - User can opt-out
 */

import { browser } from '$app/environment';
import { dbHelpers } from '$db';
import { featureFlags } from './feature-flags';

/** Analytics event types */
export type AnalyticsEventType =
	| 'page_view'
	| 'feature_used'
	| 'error'
	| 'performance'
	| 'user_action';

/** Analytics event */
export interface AnalyticsEvent {
	type: AnalyticsEventType;
	name: string;
	properties?: Record<string, string | number | boolean>;
	timestamp: number;
}

/** Performance metric */
export interface PerformanceMetric {
	name: string;
	value: number;
	unit: 'ms' | 'bytes' | 'count';
}

/** Session info (anonymous) */
interface SessionInfo {
	id: string;
	startTime: number;
	pageViews: number;
	locale: string;
	theme: string;
	screenSize: string;
	deviceType: 'mobile' | 'tablet' | 'desktop';
}

class AnalyticsService {
	private enabled: boolean = false;
	private session: SessionInfo | null = null;
	private eventQueue: AnalyticsEvent[] = [];
	private flushInterval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		if (browser) {
			void this.init();
		}
	}

	/** Initialize analytics */
	private async init(): Promise<void> {
		// Check if user has opted in
		const optedIn = await dbHelpers.getSetting<boolean>('analytics_enabled', false);
		
		// Also check feature flag
		if (optedIn && featureFlags.isEnabled('ANALYTICS')) {
			this.enable();
		}
	}

	/** Enable analytics */
	public enable(): void {
		if (!browser) return;

		this.enabled = true;
		this.startSession();

		// Flush events every 30 seconds
		this.flushInterval = setInterval(() => this.flush(), 30000);

		// Track page visibility changes
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				this.flush();
			}
		});

		// Flush on page unload
		globalThis.addEventListener('beforeunload', () => this.flush());
	}

	/** Disable analytics */
	public disable(): void {
		this.enabled = false;
		this.session = null;
		this.eventQueue = [];

		if (this.flushInterval) {
			clearInterval(this.flushInterval);
			this.flushInterval = null;
		}
	}

	/** Start a new session */
	private startSession(): void {
		if (!browser) return;

		const screenWidth = globalThis.innerWidth;
		let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';
		if (screenWidth < 768) deviceType = 'mobile';
		else if (screenWidth < 1024) deviceType = 'tablet';

		this.session = {
			id: this.generateSessionId(),
			startTime: Date.now(),
			pageViews: 0,
			locale: globalThis.navigator.language || 'en',
			theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
			screenSize: `${screenWidth}x${globalThis.innerHeight}`,
			deviceType
		};
	}

	/** Generate anonymous session ID */
	private generateSessionId(): string {
		return Math.random().toString(36).substring(2, 15);
	}

	/** Track a page view */
	public trackPageView(path: string): void {
		if (!this.enabled || !this.session) return;

		this.session.pageViews++;
		this.track('page_view', 'page_view', { path });
	}

	/** Track a feature usage */
	public trackFeatureUsed(feature: string, properties?: Record<string, string | number | boolean>): void {
		if (!this.enabled) return;
		this.track('feature_used', feature, properties);
	}

	/** Track a user action */
	public trackAction(action: string, properties?: Record<string, string | number | boolean>): void {
		if (!this.enabled) return;
		this.track('user_action', action, properties);
	}

	/** Track an error */
	public trackError(error: string, properties?: Record<string, string | number | boolean>): void {
		if (!this.enabled) return;
		this.track('error', error, {
			...properties,
			// Don't include stack traces or sensitive info
			errorType: error.split(':')[0]
		});
	}

	/** Track a performance metric */
	public trackPerformance(metric: PerformanceMetric): void {
		if (!this.enabled) return;
		this.track('performance', metric.name, {
			value: metric.value,
			unit: metric.unit
		});
	}

	/** Generic track method */
	private track(
		type: AnalyticsEventType,
		name: string,
		properties?: Record<string, string | number | boolean>
	): void {
		if (!this.enabled) return;

		const event: AnalyticsEvent = {
			type,
			name,
			properties,
			timestamp: Date.now()
		};

		this.eventQueue.push(event);

		// Flush if queue is getting large
		if (this.eventQueue.length >= 50) {
			this.flush();
		}
	}

	/** 
	 * Flush events (local only - privacy first).
	 * 
	 * AURA is a privacy-focused app. We do NOT send analytics to any server.
	 * This method only logs events locally in development mode for debugging.
	 * Users' activity data never leaves their device.
	 */
	private async flush(): Promise<void> {
		if (!this.enabled || this.eventQueue.length === 0 || !this.session) return;

		const events = [...this.eventQueue];
		this.eventQueue = [];

		// Development only: log events for debugging
		if (import.meta.env.DEV) {
			console.log('[Analytics] Local events:', {
				sessionId: this.session.id,
				eventCount: events.length,
				events: events.map(e => ({ type: e.type, name: e.name }))
			});
		}

		// Privacy note: No server reporting. All data stays on device.
	}

	/** Get session info (for debugging) */
	public getSessionInfo(): SessionInfo | null {
		return this.session;
	}

	/** Check if analytics is enabled */
	public isEnabled(): boolean {
		return this.enabled;
	}

	/** Set opt-in preference */
	public async setOptIn(optIn: boolean): Promise<void> {
		await dbHelpers.setSetting('analytics_enabled', optIn);
		
		if (optIn && featureFlags.isEnabled('ANALYTICS')) {
			this.enable();
		} else {
			this.disable();
		}
	}
}

export const analytics = new AnalyticsService();

/** Convenience functions */
export const trackPageView = (path: string) => analytics.trackPageView(path);
export const trackFeature = (feature: string, props?: Record<string, string | number | boolean>) => 
	analytics.trackFeatureUsed(feature, props);
export const trackAction = (action: string, props?: Record<string, string | number | boolean>) => 
	analytics.trackAction(action, props);
export const trackError = (error: string, props?: Record<string, string | number | boolean>) => 
	analytics.trackError(error, props);
export const trackPerformance = (metric: PerformanceMetric) => analytics.trackPerformance(metric);

export default analytics;
