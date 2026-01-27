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

			console.log('[Calls] Starting call to', peerPubkey, 'room:', roomId);

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
					console.log('[Calls] Sending signal:', signal.signalType);
					sendSignal(peerPubkey, signal);
				},
				onStream: (stream) => {
					console.log('[Calls] Got remote stream');
					remoteStream = stream;
				},
				onConnect: () => {
					console.log('[Calls] WebRTC connected');
					if (activeCall) {
						activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
					}
				},
				onClose: () => {
					console.log('[Calls] WebRTC connection closed');
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

			console.log('[Calls] Call started:', roomId);
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
				console.log('[Calls] Ignoring old call invite, age:', Math.round(ageMs / 1000), 'sec');
				return;
			}
		}

		// Ignore if already in a call
		if (activeCall) {
			console.log('[Calls] Auto-declining: already in call', activeCall.roomId);
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
					console.log('[Calls] Sending signal:', signal.signalType);
					sendSignal(callerPubkey, signal);
				},
				onStream: (stream) => {
					console.log('[Calls] Got remote stream');
					remoteStream = stream;
				},
				onConnect: () => {
					console.log('[Calls] WebRTC connected');
					if (activeCall) {
						activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
					}
				},
				onClose: () => {
					console.log('[Calls] WebRTC connection closed');
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

			// Send accept response
			await sendCallResponse(callerPubkey, roomId, 'accept');

			console.log('[Calls] Call accepted:', roomId);
			return roomId;
		} catch (e) {
			console.error('[Calls] Failed to accept call:', e);
			webrtcService.endCall();
			activeCall = null;
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
		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}
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

		if (callTimeoutId) {
			clearTimeout(callTimeoutId);
			callTimeoutId = null;
		}

		if (response.action === 'accept') {
			activeCall = { ...activeCall, status: 'connecting' };
			console.log('[Calls] Call accepted by peer');
		} else if (response.action === 'decline') {
			await endCall('declined');
		} else if (response.action === 'end') {
			await endCall('ended');
		}
	}

	/** Handle WebRTC signal from peer */
	function handleWebRTCSignal(signal: WebRTCSignal): void {
		if (!activeCall || activeCall.roomId !== signal.roomId) {
			console.log('[Calls] Ignoring signal for different room');
			return;
		}

		webrtcService.handleSignal(signal);
	}

	/** Mark call as connected */
	function markConnected(): void {
		if (activeCall && activeCall.status === 'connecting') {
			activeCall = { ...activeCall, status: 'connected', connectedAt: Date.now() };
			console.log('[Calls] Call connected');
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
		isMuted = webrtcService.toggleAudio();
		return isMuted;
	}

	/** Toggle video */
	function toggleVideo(): boolean {
		isVideoEnabled = webrtcService.toggleVideo();
		return isVideoEnabled;
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

	/** Force reset all call state (for debugging stuck calls) */
	function forceReset(): void {
		console.log('[Calls] Force resetting call state');
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
