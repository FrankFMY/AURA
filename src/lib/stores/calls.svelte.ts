/**
 * Calls Store
 *
 * Manages video/audio calls using Jitsi integration.
 * Call invitations are sent via Nostr DMs.
 */

import { authStore } from '$stores/auth.svelte';
import { messagesStore } from '$stores/messages.svelte';
import { dbHelpers, type UserProfile } from '$db';

/** Call type */
export type CallType = 'audio' | 'video';

/** Call direction */
export type CallDirection = 'incoming' | 'outgoing';

/** Call status */
export type CallStatus = 'ringing' | 'connecting' | 'connected' | 'ended' | 'declined' | 'missed';

/** Active call data */
export interface ActiveCall {
	roomId: string;
	peerPubkey: string;
	peerProfile?: UserProfile | null;
	direction: CallDirection;
	status: CallStatus;
	callType: CallType;
	startedAt: number;
	connectedAt?: number;
	endedAt?: number;
}

/** Incoming call invitation */
export interface IncomingCallData {
	roomId: string;
	callerPubkey: string;
	callerProfile?: UserProfile | null;
	callType: CallType;
	receivedAt: number;
}

/** Call history entry */
export interface CallHistoryEntry {
	id: string;
	roomId: string;
	peerPubkey: string;
	peerProfile?: UserProfile | null;
	direction: CallDirection;
	callType: CallType;
	status: CallStatus;
	startedAt: number;
	endedAt?: number;
	duration?: number;
}

/** Call invitation message format */
export interface CallInviteMessage {
	type: 'call_invite';
	roomId: string;
	callType: CallType;
}

/** Call response message format */
export interface CallResponseMessage {
	type: 'call_response';
	roomId: string;
	action: 'accept' | 'decline' | 'end';
}

// Constants
const JITSI_DOMAIN = 'meet.jit.si';
const ROOM_PREFIX = 'aura-';
const CALL_TIMEOUT = 60000; // 60 seconds

/** Generate unique room ID */
function generateRoomId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = ROOM_PREFIX;
	for (let i = 0; i < 12; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/** Check if message is a call invite */
export function isCallInvite(content: string): CallInviteMessage | null {
	try {
		const data = JSON.parse(content);
		if (data.type === 'call_invite' && data.roomId && data.callType) {
			return data as CallInviteMessage;
		}
	} catch {
		// Not JSON or invalid format
	}
	return null;
}

/** Check if message is a call response */
export function isCallResponse(content: string): CallResponseMessage | null {
	try {
		const data = JSON.parse(content);
		if (data.type === 'call_response' && data.roomId && data.action) {
			return data as CallResponseMessage;
		}
	} catch {
		// Not JSON or invalid format
	}
	return null;
}

/** Create calls store */
function createCallsStore() {
	let activeCall = $state<ActiveCall | null>(null);
	let incomingCall = $state<IncomingCallData | null>(null);
	let callHistory = $state<CallHistoryEntry[]>([]);
	let isMuted = $state(false);
	let isVideoEnabled = $state(true);
	let callTimeoutId: ReturnType<typeof setTimeout> | null = null;

	// Load call history from localStorage
	function loadCallHistory(): void {
		try {
			const stored = localStorage.getItem('aura-call-history');
			if (stored) {
				callHistory = JSON.parse(stored);
			}
		} catch (e) {
			console.error('[Calls] Failed to load call history:', e);
		}
	}

	// Save call history to localStorage
	function saveCallHistory(): void {
		try {
			// Keep last 50 calls
			const toSave = callHistory.slice(0, 50);
			localStorage.setItem('aura-call-history', JSON.stringify(toSave));
		} catch (e) {
			console.error('[Calls] Failed to save call history:', e);
		}
	}

	/** Start an outgoing call */
	async function startCall(peerPubkey: string, callType: CallType): Promise<string | null> {
		if (!authStore.isAuthenticated) {
			console.error('[Calls] Not logged in');
			return null;
		}

		if (activeCall) {
			console.error('[Calls] Already in a call');
			return null;
		}

		try {
			const roomId = generateRoomId();
			const peerProfile = await dbHelpers.getProfile(peerPubkey);

			// Create call invite message
			const invite: CallInviteMessage = {
				type: 'call_invite',
				roomId,
				callType
			};

			// Send invite via DM
			await messagesStore.sendMessage(peerPubkey, JSON.stringify(invite));

			// Set active call
			activeCall = {
				roomId,
				peerPubkey,
				peerProfile: peerProfile || null,
				direction: 'outgoing',
				status: 'ringing',
				callType,
				startedAt: Date.now()
			};

			// Set timeout for unanswered call
			callTimeoutId = setTimeout(() => {
				if (activeCall?.status === 'ringing') {
					endCall('missed');
				}
			}, CALL_TIMEOUT);

			console.log('[Calls] Call started:', roomId);
			return roomId;
		} catch (e) {
			console.error('[Calls] Failed to start call:', e);
			return null;
		}
	}

	/** Handle incoming call */
	async function handleIncomingCall(
		callerPubkey: string,
		invite: CallInviteMessage
	): Promise<void> {
		// Ignore if already in a call
		if (activeCall) {
			// Auto-decline
			await sendCallResponse(callerPubkey, invite.roomId, 'decline');
			return;
		}

		const callerProfile = await dbHelpers.getProfile(callerPubkey);

		incomingCall = {
			roomId: invite.roomId,
			callerPubkey,
			callerProfile: callerProfile || null,
			callType: invite.callType,
			receivedAt: Date.now()
		};

		// Auto-dismiss after timeout
		callTimeoutId = setTimeout(() => {
			if (incomingCall?.roomId === invite.roomId) {
				dismissIncomingCall();
				addToHistory({
					roomId: invite.roomId,
					peerPubkey: callerPubkey,
					peerProfile: callerProfile || null,
					direction: 'incoming',
					callType: invite.callType,
					status: 'missed',
					startedAt: Date.now()
				});
			}
		}, CALL_TIMEOUT);

		console.log('[Calls] Incoming call from:', callerPubkey);
	}

	/** Accept incoming call */
	async function acceptCall(): Promise<string | null> {
		if (!incomingCall) {
			console.error('[Calls] No incoming call to accept');
			return null;
		}

		clearTimeout(callTimeoutId!);

		const { roomId, callerPubkey, callerProfile, callType } = incomingCall;

		// Send accept response
		await sendCallResponse(callerPubkey, roomId, 'accept');

		// Set active call
		activeCall = {
			roomId,
			peerPubkey: callerPubkey,
			peerProfile: callerProfile,
			direction: 'incoming',
			status: 'connecting',
			callType,
			startedAt: Date.now()
		};

		incomingCall = null;

		console.log('[Calls] Call accepted:', roomId);
		return roomId;
	}

	/** Decline incoming call */
	async function declineCall(): Promise<void> {
		if (!incomingCall) return;

		clearTimeout(callTimeoutId!);

		const { roomId, callerPubkey, callerProfile, callType } = incomingCall;

		// Send decline response
		await sendCallResponse(callerPubkey, roomId, 'decline');

		// Add to history
		addToHistory({
			roomId,
			peerPubkey: callerPubkey,
			peerProfile: callerProfile,
			direction: 'incoming',
			callType,
			status: 'declined',
			startedAt: Date.now()
		});

		incomingCall = null;
		console.log('[Calls] Call declined:', roomId);
	}

	/** Dismiss incoming call without response */
	function dismissIncomingCall(): void {
		clearTimeout(callTimeoutId!);
		incomingCall = null;
	}

	/** Handle call response from peer */
	async function handleCallResponse(
		peerPubkey: string,
		response: CallResponseMessage
	): Promise<void> {
		if (!activeCall || activeCall.roomId !== response.roomId) {
			return;
		}

		clearTimeout(callTimeoutId!);

		if (response.action === 'accept') {
			// Create new object to ensure reactivity
			activeCall = { ...activeCall, status: 'connecting' };
			console.log('[Calls] Call accepted by peer');
		} else if (response.action === 'decline') {
			await endCall('declined');
		} else if (response.action === 'end') {
			await endCall('ended');
		}
	}

	/** Mark call as connected */
	function markConnected(): void {
		if (activeCall && activeCall.status === 'connecting') {
			// Create new object to ensure reactivity
			activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
			console.log('[Calls] Call connected');
		}
	}

	/** End active call */
	async function endCall(status: CallStatus = 'ended'): Promise<void> {
		if (!activeCall) return;

		clearTimeout(callTimeoutId!);

		const endedAt = Date.now();
		const duration = activeCall.connectedAt
			? endedAt - activeCall.connectedAt
			: undefined;

		// Send end response if we're ending the call
		if (status === 'ended' && activeCall.status === 'connected') {
			await sendCallResponse(activeCall.peerPubkey, activeCall.roomId, 'end');
		}

		// Add to history
		addToHistory({
			roomId: activeCall.roomId,
			peerPubkey: activeCall.peerPubkey,
			peerProfile: activeCall.peerProfile,
			direction: activeCall.direction,
			callType: activeCall.callType,
			status,
			startedAt: activeCall.startedAt,
			endedAt,
			duration
		});

		activeCall = null;
		isMuted = false;
		isVideoEnabled = true;

		console.log('[Calls] Call ended:', status);
	}

	/** Send call response message */
	async function sendCallResponse(
		peerPubkey: string,
		roomId: string,
		action: 'accept' | 'decline' | 'end'
	): Promise<void> {
		const response: CallResponseMessage = {
			type: 'call_response',
			roomId,
			action
		};

		await messagesStore.sendMessage(peerPubkey, JSON.stringify(response));
	}

	/** Add call to history */
	function addToHistory(entry: Omit<CallHistoryEntry, 'id'>): void {
		const historyEntry: CallHistoryEntry = {
			...entry,
			id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		};

		callHistory = [historyEntry, ...callHistory];
		saveCallHistory();
	}

	/** Toggle mute */
	function toggleMute(): boolean {
		isMuted = !isMuted;
		return isMuted;
	}

	/** Toggle video */
	function toggleVideo(): boolean {
		isVideoEnabled = !isVideoEnabled;
		return isVideoEnabled;
	}

	/** Get Jitsi room URL */
	function getJitsiUrl(roomId: string): string {
		return `https://${JITSI_DOMAIN}/${roomId}`;
	}

	/** Format call duration */
	function formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
		}
		return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
	}

	// Initialize
	loadCallHistory();

	return {
		// State
		get activeCall() {
			return activeCall;
		},
		get incomingCall() {
			return incomingCall;
		},
		get callHistory() {
			return callHistory;
		},
		get isMuted() {
			return isMuted;
		},
		get isVideoEnabled() {
			return isVideoEnabled;
		},
		get isInCall() {
			return activeCall !== null;
		},
		get hasIncomingCall() {
			return incomingCall !== null;
		},

		// Actions
		startCall,
		handleIncomingCall,
		acceptCall,
		declineCall,
		dismissIncomingCall,
		handleCallResponse,
		markConnected,
		endCall,
		toggleMute,
		toggleVideo,

		// Utilities
		getJitsiUrl,
		formatDuration,

		// Constants
		JITSI_DOMAIN
	};
}

/** Calls store singleton */
export const callsStore = createCallsStore();

export default callsStore;
