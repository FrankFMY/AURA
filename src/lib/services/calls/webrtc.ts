/**
 * WebRTC Service
 *
 * Handles peer-to-peer video/audio calls using native WebRTC API.
 * Uses Nostr DMs for signaling (offer/answer/ICE candidates).
 */

import { browser } from '$app/environment';

// STUN/TURN servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
	{ urls: 'stun:stun2.l.google.com:19302' },
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

/** Signal data format */
export type SignalData =
	| { type: 'offer'; sdp: string }
	| { type: 'answer'; sdp: string }
	| { type: 'ice-candidate'; candidate: RTCIceCandidateInit | null };

/** WebRTC signal message format */
export interface WebRTCSignal {
	type: 'webrtc_signal';
	signalType: SignalType;
	roomId: string;
	data: SignalData;
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

/** WebRTC Peer Connection Manager using native API */
class WebRTCService {
	private pc: RTCPeerConnection | null = null;
	private localStream: MediaStream | null = null;
	private remoteStream: MediaStream | null = null;
	private callbacks: WebRTCCallbacks | null = null;
	private roomId: string | null = null;
	private isInitiator: boolean = false;
	private iceCandidatesQueue: RTCIceCandidateInit[] = [];

	/** Check if WebRTC is supported */
	get isSupported(): boolean {
		if (!browser) return false;
		return (
			typeof navigator?.mediaDevices?.getUserMedia === 'function' &&
			typeof RTCPeerConnection === 'function'
		);
	}

	/** Get current connection state */
	get isConnected(): boolean {
		return this.pc?.connectionState === 'connected';
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

		await this.getLocalStream(isVideo);
		this.createPeerConnection();
		await this.createOffer();
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

		await this.getLocalStream(isVideo);
		this.createPeerConnection();
	}

	/** Handle incoming signal from remote peer */
	async handleSignal(signal: WebRTCSignal): Promise<void> {
		if (!this.pc) {
			console.warn('[WebRTC] Received signal but no peer connection exists');
			return;
		}

		if (signal.roomId !== this.roomId) {
			console.warn('[WebRTC] Signal room mismatch:', signal.roomId, '!=', this.roomId);
			return;
		}

		console.log('[WebRTC] Handling signal:', signal.signalType);

		try {
			if (signal.signalType === 'offer' && signal.data.type === 'offer') {
				await this.pc.setRemoteDescription({
					type: 'offer',
					sdp: signal.data.sdp
				});
				await this.processQueuedCandidates();
				await this.createAnswer();
			} else if (signal.signalType === 'answer' && signal.data.type === 'answer') {
				await this.pc.setRemoteDescription({
					type: 'answer',
					sdp: signal.data.sdp
				});
				await this.processQueuedCandidates();
			} else if (signal.signalType === 'ice-candidate' && signal.data.type === 'ice-candidate') {
				if (signal.data.candidate) {
					if (this.pc.remoteDescription) {
						await this.pc.addIceCandidate(signal.data.candidate);
					} else {
						this.iceCandidatesQueue.push(signal.data.candidate);
					}
				}
			}
		} catch (error) {
			console.error('[WebRTC] Error handling signal:', error);
		}
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

	/** Create RTCPeerConnection */
	private createPeerConnection(): void {
		console.log('[WebRTC] Creating peer connection');

		this.pc = new RTCPeerConnection({
			iceServers: ICE_SERVERS
		});

		// Add local tracks to the connection
		if (this.localStream) {
			this.localStream.getTracks().forEach(track => {
				this.pc!.addTrack(track, this.localStream!);
			});
		}

		// Handle ICE candidates
		this.pc.onicecandidate = (event) => {
			if (event.candidate) {
				console.log('[WebRTC] Got ICE candidate');
				this.sendSignal('ice-candidate', {
					type: 'ice-candidate',
					candidate: event.candidate.toJSON()
				});
			}
		};

		// Handle remote stream
		this.pc.ontrack = (event) => {
			console.log('[WebRTC] Got remote track:', event.track.kind);
			if (!this.remoteStream) {
				this.remoteStream = new MediaStream();
			}
			this.remoteStream.addTrack(event.track);
			this.callbacks?.onStream(this.remoteStream);
		};

		// Handle connection state changes
		this.pc.onconnectionstatechange = () => {
			console.log('[WebRTC] Connection state:', this.pc?.connectionState);
			if (this.pc?.connectionState === 'connected') {
				this.callbacks?.onConnect();
			} else if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'closed') {
				this.callbacks?.onClose();
			}
		};

		// Handle ICE connection state for errors
		this.pc.oniceconnectionstatechange = () => {
			console.log('[WebRTC] ICE state:', this.pc?.iceConnectionState);
			if (this.pc?.iceConnectionState === 'failed') {
				this.callbacks?.onError(new Error('ICE connection failed'));
			}
		};
	}

	/** Create and send offer */
	private async createOffer(): Promise<void> {
		if (!this.pc) return;

		try {
			const offer = await this.pc.createOffer();
			await this.pc.setLocalDescription(offer);

			console.log('[WebRTC] Created offer');
			this.sendSignal('offer', {
				type: 'offer',
				sdp: offer.sdp!
			});
		} catch (error) {
			console.error('[WebRTC] Failed to create offer:', error);
			this.callbacks?.onError(error as Error);
		}
	}

	/** Create and send answer */
	private async createAnswer(): Promise<void> {
		if (!this.pc) return;

		try {
			const answer = await this.pc.createAnswer();
			await this.pc.setLocalDescription(answer);

			console.log('[WebRTC] Created answer');
			this.sendSignal('answer', {
				type: 'answer',
				sdp: answer.sdp!
			});
		} catch (error) {
			console.error('[WebRTC] Failed to create answer:', error);
			this.callbacks?.onError(error as Error);
		}
	}

	/** Process queued ICE candidates */
	private async processQueuedCandidates(): Promise<void> {
		while (this.iceCandidatesQueue.length > 0) {
			const candidate = this.iceCandidatesQueue.shift();
			if (candidate && this.pc) {
				await this.pc.addIceCandidate(candidate);
			}
		}
	}

	/** Send signal via callback */
	private sendSignal(signalType: SignalType, data: SignalData): void {
		const signal: WebRTCSignal = {
			type: 'webrtc_signal',
			signalType,
			roomId: this.roomId!,
			data
		};
		this.callbacks?.onSignal(signal);
	}

	/** Toggle audio mute */
	toggleAudio(): boolean {
		if (!this.localStream) return false;

		const audioTrack = this.localStream.getAudioTracks()[0];
		if (audioTrack) {
			audioTrack.enabled = !audioTrack.enabled;
			console.log('[WebRTC] Audio:', audioTrack.enabled ? 'unmuted' : 'muted');
			return !audioTrack.enabled;
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

		// Close peer connection
		if (this.pc) {
			this.pc.close();
			this.pc = null;
		}

		// Clear state
		this.remoteStream = null;
		this.callbacks = null;
		this.roomId = null;
		this.isInitiator = false;
		this.iceCandidatesQueue = [];
	}

	/** Switch camera (for mobile) */
	async switchCamera(): Promise<void> {
		if (!this.localStream) return;

		const videoTrack = this.localStream.getVideoTracks()[0];
		if (!videoTrack) return;

		const settings = videoTrack.getSettings();
		const currentFacing = settings.facingMode || 'user';
		const newFacing = currentFacing === 'user' ? 'environment' : 'user';

		try {
			const newStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: newFacing }
			});

			const newVideoTrack = newStream.getVideoTracks()[0];

			if (this.pc && newVideoTrack) {
				const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
				if (sender) {
					await sender.replaceTrack(newVideoTrack);
				}

				this.localStream.removeTrack(videoTrack);
				videoTrack.stop();
				this.localStream.addTrack(newVideoTrack);

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
