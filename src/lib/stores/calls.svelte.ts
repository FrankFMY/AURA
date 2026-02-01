/**
 * Calls Store
 *
 * Manages video/audio calls using native WebRTC.
 * Signaling is done via Nostr DMs.
 */

import { browser } from '$app/environment';
import { authStore } from '$stores/auth.svelte';
import { messagesStore } from '$stores/messages.svelte';
import { dbHelpers, type UserProfile } from '$db';
import { webrtcService, type WebRTCSignal } from '$services/calls/webrtc';

// Dev-only logging
const debug = (...args: unknown[]) => {
	if (import.meta.env.DEV) {
		debug('', ...args);
	}
};

/** Call type */
export type CallType = 'audio' | 'video';

/** Call direction */
export type CallDirection = 'incoming' | 'outgoing';

/** Call status */
export type CallStatus = 'ringing' | 'connecting' | 'connected' | 'ended' | 'declined' | 'missed' | 'failed';

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
const ROOM_PREFIX = 'aura-';
const CALL_TIMEOUT = 60000; // 60 seconds

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

/** Check if message is a WebRTC signal */
export function isWebRTCSignal(content: string): WebRTCSignal | null {
	try {
		const data = JSON.parse(content);
		if (data.type === 'webrtc_signal' && data.signalType && data.roomId && data.data) {
			return data as WebRTCSignal;
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
	let localStream = $state<MediaStream | null>(null);
	let remoteStream = $state<MediaStream | null>(null);
	let callTimeoutId: ReturnType<typeof setTimeout> | null = null;

	// Buffer for signals that arrive before call is accepted
	let pendingSignals: Map<string, WebRTCSignal[]> = new Map();

	// Buffer for signals that arrive before call_invite (race condition fix)
	// These are signals for rooms we don't know about yet
	let orphanSignals: Map<string, { signals: WebRTCSignal[]; timestamp: number }> = new Map();

	// Load call history from localStorage
	function loadCallHistory(): void {
		if (!browser) return;
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
		if (!browser) return;
		try {
			// Keep last 50 calls
			const toSave = callHistory.slice(0, 50);
			localStorage.setItem('aura-call-history', JSON.stringify(toSave));
		} catch (e) {
			console.error('[Calls] Failed to save call history:', e);
		}
	}

	/** Send WebRTC signal via Nostr DM */
	async function sendSignal(peerPubkey: string, signal: WebRTCSignal): Promise<void> {
		await messagesStore.sendMessage(peerPubkey, JSON.stringify(signal));
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

		if (!webrtcService.isSupported) {
			console.error('[Calls] WebRTC not supported');
			return null;
		}

		try {
			const roomId = generateRoomId();
			const peerProfile = await dbHelpers.getProfile(peerPubkey);

			debug(' Starting call to', peerPubkey, 'room:', roomId);

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

			// Initialize WebRTC as initiator
			await webrtcService.initCall(roomId, callType === 'video', {
				onSignal: (signal) => {
					debug(' Sending signal:', signal.signalType);
					sendSignal(peerPubkey, signal);
				},
				onStream: (stream) => {
					debug(' Got remote stream');
					remoteStream = stream;
				},
				onConnect: () => {
					debug(' WebRTC connected');
					if (activeCall) {
						activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
					}
				},
				onClose: () => {
					debug(' WebRTC connection closed');
					endCall('ended');
				},
				onError: (error) => {
					console.error('[Calls] WebRTC error:', error);
					endCall('failed');
				}
			});

			// Update local stream reference
			localStream = webrtcService.localMediaStream;
			isVideoEnabled = callType === 'video';

			// Send call invite via Nostr DM
			const invite: CallInviteMessage = {
				type: 'call_invite',
				roomId,
				callType
			};
			await messagesStore.sendMessage(peerPubkey, JSON.stringify(invite));

			// Set timeout for unanswered call
			callTimeoutId = setTimeout(() => {
				if (activeCall?.status === 'ringing') {
					endCall('missed');
				}
			}, CALL_TIMEOUT);

			debug(' Call started:', roomId);
			return roomId;
		} catch (e) {
			console.error('[Calls] Failed to start call:', e);
			webrtcService.endCall();
			activeCall = null;
			return null;
		}
	}

	/** Handle incoming call */
	async function handleIncomingCall(
		callerPubkey: string,
		invite: CallInviteMessage,
		messageTimestamp?: number
	): Promise<void> {
		// Ignore old call invites (older than 2 minutes)
		if (messageTimestamp) {
			const ageMs = Date.now() - messageTimestamp * 1000;
			if (ageMs > 120000) {
				debug(' Ignoring old call invite, age:', Math.round(ageMs / 1000), 'sec');
				return;
			}
		}

		// Ignore if already in a call
		if (activeCall) {
			debug(' Auto-declining: already in call', activeCall.roomId);
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

		// Check for orphan signals that arrived before this call_invite (race condition fix)
		const orphan = orphanSignals.get(invite.roomId);
		if (orphan && orphan.signals.length > 0) {
			debug(' Found', orphan.signals.length, 'orphan signals for room:', invite.roomId);
			// Move orphan signals to pending signals
			const existing = pendingSignals.get(invite.roomId) || [];
			pendingSignals.set(invite.roomId, [...orphan.signals, ...existing]);
			orphanSignals.delete(invite.roomId);
		}

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

		debug(' Incoming call from:', callerPubkey);
	}

	/** Accept incoming call */
	async function acceptCall(): Promise<string | null> {
		if (!incomingCall) {
			console.error('[Calls] No incoming call to accept');
			return null;
		}

		if (!webrtcService.isSupported) {
			console.error('[Calls] WebRTC not supported');
			return null;
		}

		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}

		const { roomId, callerPubkey, callerProfile, callType } = incomingCall;

		try {
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

			// Initialize WebRTC as answerer
			await webrtcService.answerCall(roomId, callType === 'video', {
				onSignal: (signal) => {
					debug(' Sending signal:', signal.signalType);
					sendSignal(callerPubkey, signal);
				},
				onStream: (stream) => {
					debug(' Got remote stream');
					remoteStream = stream;
				},
				onConnect: () => {
					debug(' WebRTC connected');
					if (activeCall) {
						activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
					}
				},
				onClose: () => {
					debug(' WebRTC connection closed');
					endCall('ended');
				},
				onError: (error) => {
					console.error('[Calls] WebRTC error:', error);
					endCall('failed');
				}
			});

			// Update local stream reference
			localStream = webrtcService.localMediaStream;
			isVideoEnabled = callType === 'video';

			// Process any buffered signals that arrived before we accepted
			processPendingSignals(roomId);

			// Send accept response
			await sendCallResponse(callerPubkey, roomId, 'accept');

			debug(' Call accepted:', roomId);
			return roomId;
		} catch (e) {
			console.error('[Calls] Failed to accept call:', e);
			webrtcService.endCall();
			activeCall = null;
			clearPendingSignals(roomId);
			await sendCallResponse(callerPubkey, roomId, 'decline');
			return null;
		}
	}

	/** Decline incoming call */
	async function declineCall(): Promise<void> {
		if (!incomingCall) return;

		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}

		const { roomId, callerPubkey, callerProfile, callType } = incomingCall;

		// Clear any buffered signals
		clearPendingSignals(roomId);

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
		debug(' Call declined:', roomId);
	}

	/** Dismiss incoming call without response */
	function dismissIncomingCall(): void {
		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}
		if (incomingCall) {
			clearPendingSignals(incomingCall.roomId);
		}
		incomingCall = null;
	}

	/** Handle call response from peer */
	async function handleCallResponse(
		_peerPubkey: string,
		response: CallResponseMessage
	): Promise<void> {
		if (!activeCall || activeCall.roomId !== response.roomId) {
			return;
		}

		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}

		if (response.action === 'accept') {
			activeCall = { ...activeCall, status: 'connecting' };
			debug(' Call accepted by peer');
		} else if (response.action === 'decline') {
			await endCall('declined');
		} else if (response.action === 'end') {
			await endCall('ended');
		}
	}

	/** Handle WebRTC signal from peer */
	async function handleWebRTCSignal(signal: WebRTCSignal): Promise<void> {
		// If we have an active call for this room, forward signal directly
		if (activeCall && activeCall.roomId === signal.roomId) {
			debug(' Forwarding signal to WebRTC:', signal.signalType);
			await webrtcService.handleSignal(signal);
			return;
		}

		// If we have an incoming call for this room, buffer the signal
		// (signals may arrive before user accepts the call)
		if (incomingCall && incomingCall.roomId === signal.roomId) {
			debug(' Buffering signal for incoming call:', signal.signalType);
			const buffered = pendingSignals.get(signal.roomId) || [];
			buffered.push(signal);
			pendingSignals.set(signal.roomId, buffered);
			return;
		}

		// Buffer signals for unknown rooms (they may arrive before call_invite due to race condition)
		// This fixes the issue where offer arrives before call_invite
		debug(' Buffering orphan signal for room:', signal.roomId, 'type:', signal.signalType);
		const orphan = orphanSignals.get(signal.roomId) || { signals: [], timestamp: Date.now() };
		orphan.signals.push(signal);
		orphanSignals.set(signal.roomId, orphan);

		// Cleanup old orphan signals (older than 30 seconds)
		const now = Date.now();
		for (const [roomId, data] of orphanSignals.entries()) {
			if (now - data.timestamp > 30000) {
				debug(' Cleaning up old orphan signals for room:', roomId);
				orphanSignals.delete(roomId);
			}
		}
	}

	/** Process buffered signals for a room */
	async function processPendingSignals(roomId: string): Promise<void> {
		const signals = pendingSignals.get(roomId);
		if (!signals || signals.length === 0) return;

		debug(' Processing', signals.length, 'buffered signals for room:', roomId);

		for (const signal of signals) {
			await webrtcService.handleSignal(signal);
		}

		pendingSignals.delete(roomId);
	}

	/** Clear buffered signals for a room */
	function clearPendingSignals(roomId: string): void {
		pendingSignals.delete(roomId);
	}

	/** Mark call as connected */
	function markConnected(): void {
		if (activeCall?.status === 'connecting') {
			activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
			debug(' Call connected');
		}
	}

	/** End active call */
	async function endCall(status: CallStatus = 'ended'): Promise<void> {
		if (!activeCall) return;

		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}

		const endedAt = Date.now();
		const duration = activeCall.connectedAt
			? endedAt - activeCall.connectedAt
			: undefined;

		// Clear any pending signals for this room
		clearPendingSignals(activeCall.roomId);

		// Send end response if we're ending the call
		if (status === 'ended' && activeCall.status === 'connected') {
			await sendCallResponse(activeCall.peerPubkey, activeCall.roomId, 'end');
		}

		// End WebRTC connection
		webrtcService.endCall();

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
		localStream = null;
		remoteStream = null;
		isMuted = false;
		isVideoEnabled = true;

		debug(' Call ended:', status);
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
		isMuted = webrtcService.toggleAudio();
		return isMuted;
	}

	/** Toggle video */
	function toggleVideo(): boolean {
		isVideoEnabled = webrtcService.toggleVideo();
		return isVideoEnabled;
	}

	/** Force reset all call state (for debugging stuck calls) */
	function forceReset(): void {
		debug(' Force resetting call state');
		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}
		webrtcService.endCall();
		activeCall = null;
		incomingCall = null;
		localStream = null;
		remoteStream = null;
		isMuted = false;
		isVideoEnabled = true;
		pendingSignals.clear();
		orphanSignals.clear();
	}

	// Initialize
	if (browser) {
		loadCallHistory();
	}

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
		get localStream() {
			return localStream;
		},
		get remoteStream() {
			return remoteStream;
		},

		// Actions
		startCall,
		handleIncomingCall,
		acceptCall,
		declineCall,
		dismissIncomingCall,
		handleCallResponse,
		handleWebRTCSignal,
		markConnected,
		endCall,
		toggleMute,
		toggleVideo,
		forceReset,

		// Utilities
		formatDuration
	};
}

/** Calls store singleton */
export const callsStore = createCallsStore();

export default callsStore;
