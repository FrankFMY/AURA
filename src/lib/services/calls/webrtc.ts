/**
 * WebRTC Service
 *
 * Handles peer-to-peer video/audio calls using WebRTC.
 * Uses Nostr DMs for signaling (offer/answer/ICE candidates).
 */

import { browser } from '$app/environment';
import SimplePeer from 'simple-peer';

// STUN/TURN servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
	// Google's free STUN servers
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
	{ urls: 'stun:stun2.l.google.com:19302' },
	{ urls: 'stun:stun3.l.google.com:19302' },
	{ urls: 'stun:stun4.l.google.com:19302' },
	// Additional free STUN servers
	{ urls: 'stun:stun.stunprotocol.org:3478' },
	{ urls: 'stun:stun.voip.blackberry.com:3478' },
	// Free TURN server from metered.ca (limited but works for testing)
	{
		urls: 'turn:a.relay.metered.ca:80',
		username: 'e8dd65c92f6a932f5c403127',
		credential: 'uWdxLfQL+Uu8Lp/T'
	},
	{
		urls: 'turn:a.relay.metered.ca:443',
		username: 'e8dd65c92f6a932f5c403127',
		credential: 'uWdxLfQL+Uu8Lp/T'
	},
	{
		urls: 'turn:a.relay.metered.ca:443?transport=tcp',
		username: 'e8dd65c92f6a932f5c403127',
		credential: 'uWdxLfQL+Uu8Lp/T'
	}
];

/** WebRTC signal types for Nostr messaging */
export type SignalType = 'offer' | 'answer' | 'ice-candidate';

/** WebRTC signal message format */
export interface WebRTCSignal {
	type: 'webrtc_signal';
	signalType: SignalType;
	roomId: string;
	data: SimplePeer.SignalData;
}

/** Call events */
export interface WebRTCCallbacks {
	onSignal: (signal: WebRTCSignal) => void;
	onStream: (stream: MediaStream) => void;
	onConnect: () => void;
	onClose: () => void;
	onError: (error: Error) => void;
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

/** WebRTC Peer Connection Manager */
class WebRTCService {
	private peer: SimplePeer.Instance | null = null;
	private localStream: MediaStream | null = null;
	private remoteStream: MediaStream | null = null;
	private callbacks: WebRTCCallbacks | null = null;
	private roomId: string | null = null;
	private isInitiator: boolean = false;

	/** Check if WebRTC is supported */
	get isSupported(): boolean {
		if (!browser) return false;
		return (
			typeof navigator !== 'undefined' &&
			typeof navigator.mediaDevices !== 'undefined' &&
			typeof navigator.mediaDevices.getUserMedia === 'function' &&
			typeof window.RTCPeerConnection === 'function'
		);
	}

	/** Get current connection state */
	get isConnected(): boolean {
		return this.peer?.connected ?? false;
	}

	/** Get local media stream */
	get localMediaStream(): MediaStream | null {
		return this.localStream;
	}

	/** Get remote media stream */
	get remoteMediaStream(): MediaStream | null {
		return this.remoteStream;
	}

	/** Initialize a call (as initiator) */
	async initCall(
		roomId: string,
		isVideo: boolean,
		callbacks: WebRTCCallbacks
	): Promise<void> {
		if (!browser) throw new Error('WebRTC is only available in browser');

		console.log('[WebRTC] Initializing call as initiator, room:', roomId);

		this.roomId = roomId;
		this.isInitiator = true;
		this.callbacks = callbacks;

		// Get local media stream
		await this.getLocalStream(isVideo);

		// Create peer connection as initiator
		this.createPeer(true);
	}

	/** Answer an incoming call */
	async answerCall(
		roomId: string,
		isVideo: boolean,
		callbacks: WebRTCCallbacks
	): Promise<void> {
		if (!browser) throw new Error('WebRTC is only available in browser');

		console.log('[WebRTC] Answering call, room:', roomId);

		this.roomId = roomId;
		this.isInitiator = false;
		this.callbacks = callbacks;

		// Get local media stream
		await this.getLocalStream(isVideo);

		// Create peer connection as answerer (not initiator)
		this.createPeer(false);
	}

	/** Handle incoming signal from remote peer */
	handleSignal(signal: WebRTCSignal): void {
		if (!this.peer) {
			console.warn('[WebRTC] Received signal but no peer exists');
			return;
		}

		if (signal.roomId !== this.roomId) {
			console.warn('[WebRTC] Signal room mismatch:', signal.roomId, '!=', this.roomId);
			return;
		}

		console.log('[WebRTC] Handling signal:', signal.signalType);
		this.peer.signal(signal.data);
	}

	/** Get local media stream */
	private async getLocalStream(isVideo: boolean): Promise<void> {
		try {
			console.log('[WebRTC] Getting local stream, video:', isVideo);

			this.localStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				},
				video: isVideo
					? {
							width: { ideal: 1280 },
							height: { ideal: 720 },
							facingMode: 'user'
						}
					: false
			});

			console.log('[WebRTC] Got local stream:', this.localStream.getTracks().map(t => t.kind));
		} catch (error) {
			console.error('[WebRTC] Failed to get local stream:', error);
			throw new Error('Failed to access camera/microphone. Please check permissions.');
		}
	}

	/** Create SimplePeer instance */
	private createPeer(initiator: boolean): void {
		console.log('[WebRTC] Creating peer, initiator:', initiator);

		this.peer = new SimplePeer({
			initiator,
			stream: this.localStream || undefined,
			trickle: true,
			config: {
				iceServers: ICE_SERVERS
			}
		});

		// Handle outgoing signals (send to remote peer via Nostr)
		this.peer.on('signal', (data) => {
			console.log('[WebRTC] Got signal to send:', data.type || 'ice-candidate');

			const signalType: SignalType =
				data.type === 'offer' ? 'offer' :
				data.type === 'answer' ? 'answer' :
				'ice-candidate';

			const signal: WebRTCSignal = {
				type: 'webrtc_signal',
				signalType,
				roomId: this.roomId!,
				data
			};

			this.callbacks?.onSignal(signal);
		});

		// Handle incoming remote stream
		this.peer.on('stream', (stream) => {
			console.log('[WebRTC] Got remote stream:', stream.getTracks().map(t => t.kind));
			this.remoteStream = stream;
			this.callbacks?.onStream(stream);
		});

		// Handle connection established
		this.peer.on('connect', () => {
			console.log('[WebRTC] Connected!');
			this.callbacks?.onConnect();
		});

		// Handle connection closed
		this.peer.on('close', () => {
			console.log('[WebRTC] Connection closed');
			this.callbacks?.onClose();
		});

		// Handle errors
		this.peer.on('error', (error) => {
			console.error('[WebRTC] Error:', error);
			this.callbacks?.onError(error);
		});
	}

	/** Toggle audio mute */
	toggleAudio(): boolean {
		if (!this.localStream) return false;

		const audioTrack = this.localStream.getAudioTracks()[0];
		if (audioTrack) {
			audioTrack.enabled = !audioTrack.enabled;
			console.log('[WebRTC] Audio:', audioTrack.enabled ? 'unmuted' : 'muted');
			return !audioTrack.enabled; // Return isMuted
		}
		return false;
	}

	/** Toggle video */
	toggleVideo(): boolean {
		if (!this.localStream) return false;

		const videoTrack = this.localStream.getVideoTracks()[0];
		if (videoTrack) {
			videoTrack.enabled = !videoTrack.enabled;
			console.log('[WebRTC] Video:', videoTrack.enabled ? 'on' : 'off');
			return videoTrack.enabled;
		}
		return false;
	}

	/** Set audio mute state */
	setAudioMuted(muted: boolean): void {
		if (!this.localStream) return;

		const audioTrack = this.localStream.getAudioTracks()[0];
		if (audioTrack) {
			audioTrack.enabled = !muted;
		}
	}

	/** Set video enabled state */
	setVideoEnabled(enabled: boolean): void {
		if (!this.localStream) return;

		const videoTrack = this.localStream.getVideoTracks()[0];
		if (videoTrack) {
			videoTrack.enabled = enabled;
		}
	}

	/** Check if audio is muted */
	get isAudioMuted(): boolean {
		if (!this.localStream) return true;
		const audioTrack = this.localStream.getAudioTracks()[0];
		return audioTrack ? !audioTrack.enabled : true;
	}

	/** Check if video is enabled */
	get isVideoEnabled(): boolean {
		if (!this.localStream) return false;
		const videoTrack = this.localStream.getVideoTracks()[0];
		return videoTrack ? videoTrack.enabled : false;
	}

	/** End the call and clean up */
	endCall(): void {
		console.log('[WebRTC] Ending call');

		// Stop all local tracks
		if (this.localStream) {
			this.localStream.getTracks().forEach(track => {
				track.stop();
				console.log('[WebRTC] Stopped track:', track.kind);
			});
			this.localStream = null;
		}

		// Destroy peer connection
		if (this.peer) {
			this.peer.destroy();
			this.peer = null;
		}

		// Clear state
		this.remoteStream = null;
		this.callbacks = null;
		this.roomId = null;
		this.isInitiator = false;
	}

	/** Switch camera (for mobile) */
	async switchCamera(): Promise<void> {
		if (!this.localStream) return;

		const videoTrack = this.localStream.getVideoTracks()[0];
		if (!videoTrack) return;

		// Get current facing mode
		const settings = videoTrack.getSettings();
		const currentFacing = settings.facingMode || 'user';
		const newFacing = currentFacing === 'user' ? 'environment' : 'user';

		try {
			// Get new stream with switched camera
			const newStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: newFacing }
			});

			const newVideoTrack = newStream.getVideoTracks()[0];

			// Replace track in peer connection
			if (this.peer && newVideoTrack) {
				// Remove old track and add new one
				this.localStream.removeTrack(videoTrack);
				videoTrack.stop();
				this.localStream.addTrack(newVideoTrack);

				// SimplePeer doesn't have replaceTrack, so we need to handle this differently
				// For now, just update local stream
				console.log('[WebRTC] Switched to', newFacing, 'camera');
			}
		} catch (error) {
			console.error('[WebRTC] Failed to switch camera:', error);
		}
	}
}

/** WebRTC service singleton */
export const webrtcService = new WebRTCService();

export default webrtcService;
