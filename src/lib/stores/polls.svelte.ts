/**
 * Polls Store
 *
 * Manages poll creation, voting, and results using NIP-1068.
 * Poll events use kind:1068, votes use kind:1018.
 */

import ndkService from '$services/ndk';
import { authStore } from '$stores/auth.svelte';
import { NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk';

/** Poll option */
export interface PollOption {
	index: number;
	text: string;
	votes: number;
}

/** Poll data */
export interface Poll {
	id: string;
	pubkey: string;
	question: string;
	options: PollOption[];
	endsAt?: number;
	createdAt: number;
	totalVotes: number;
	userVote?: number; // Index of user's vote
	isClosed: boolean;
}

/** Create poll options */
export interface CreatePollOptions {
	question: string;
	options: string[];
	endsAt?: number; // Unix timestamp
}

// Event kinds
const POLL_KIND = 1068;
const VOTE_KIND = 1018;

/** Create polls store */
function createPollsStore() {
	let polls = $state<Map<string, Poll>>(new Map());
	let isLoading = $state(false);
	let activeSubscription: NDKSubscription | null = null;

	/** Parse poll event into Poll object */
	function parsePollEvent(event: NDKEvent): Poll | null {
		try {
			const options: PollOption[] = [];
			let endsAt: number | undefined;

			for (const tag of event.tags) {
				if (tag[0] === 'poll_option' && tag[1] && tag[2]) {
					options.push({
						index: Number.parseInt(tag[1], 10),
						text: tag[2],
						votes: 0
					});
				}
				if (tag[0] === 'endsAt' && tag[1]) {
					endsAt = Number.parseInt(tag[1], 10);
				}
			}

			if (options.length < 2) {
				return null;
			}

			const now = Math.floor(Date.now() / 1000);
			const isClosed = endsAt ? now > endsAt : false;

			return {
				id: event.id,
				pubkey: event.pubkey,
				question: event.content,
				options: options.sort((a, b) => a.index - b.index),
				endsAt,
				createdAt: event.created_at || now,
				totalVotes: 0,
				isClosed
			};
		} catch (e) {
			console.error('[Polls] Failed to parse poll event:', e);
			return null;
		}
	}

	/** Fetch votes for a poll */
	async function fetchVotes(pollId: string): Promise<void> {
		const poll = polls.get(pollId);
		if (!poll) return;

		try {
			const filter = {
				kinds: [VOTE_KIND],
				'#e': [pollId],
				limit: 1000
			};

			const events = await ndkService.ndk.fetchEvents(filter);
			const voteCounts = new Map<number, number>();
			const voters = new Set<string>();
			let userVote: number | undefined;
			const currentPubkey = authStore.pubkey;

			for (const event of events) {
				// Only count first vote from each user
				if (voters.has(event.pubkey)) continue;
				voters.add(event.pubkey);

				// Find response tag
				const responseTag = event.tags.find((t) => t[0] === 'response');
				if (responseTag && responseTag[1]) {
					const optionIndex = Number.parseInt(responseTag[1], 10);
					voteCounts.set(optionIndex, (voteCounts.get(optionIndex) || 0) + 1);

					// Track user's vote
					if (currentPubkey && event.pubkey === currentPubkey) {
						userVote = optionIndex;
					}
				}
			}

			// Update poll with vote counts
			const updatedOptions = poll.options.map((opt) => ({
				...opt,
				votes: voteCounts.get(opt.index) || 0
			}));

			const totalVotes = Array.from(voteCounts.values()).reduce((a, b) => a + b, 0);

			polls.set(pollId, {
				...poll,
				options: updatedOptions,
				totalVotes,
				userVote
			});

			// Trigger reactivity
			polls = new Map(polls);
		} catch (e) {
			console.error('[Polls] Failed to fetch votes:', e);
		}
	}

	/** Create a new poll */
	async function createPoll(options: CreatePollOptions): Promise<string | null> {
		if (!authStore.isAuthenticated) {
			console.error('[Polls] Not logged in');
			return null;
		}

		if (options.options.length < 2 || options.options.length > 4) {
			console.error('[Polls] Invalid number of options (2-4 required)');
			return null;
		}

		try {
			const event = new NDKEvent(ndkService.ndk);
			event.kind = POLL_KIND;
			event.content = options.question;

			// Add poll options
			options.options.forEach((text, index) => {
				event.tags.push(['poll_option', index.toString(), text]);
			});

			// Add end time if specified
			if (options.endsAt) {
				event.tags.push(['endsAt', options.endsAt.toString()]);
			}

			// Single choice by default
			event.tags.push(['valueMax', '1']);

			// Add client tag
			event.tags.push(['client', 'AURA']);

			await event.sign();
			await event.publish();

			console.log('[Polls] Poll created:', event.id);

			// Add to local state
			const poll = parsePollEvent(event);
			if (poll) {
				polls.set(event.id, poll);
				polls = new Map(polls);
			}

			return event.id;
		} catch (e) {
			console.error('[Polls] Failed to create poll:', e);
			return null;
		}
	}

	/** Vote on a poll */
	async function vote(pollId: string, optionIndex: number): Promise<boolean> {
		if (!authStore.isAuthenticated) {
			console.error('[Polls] Not logged in');
			return false;
		}

		const poll = polls.get(pollId);
		if (!poll) {
			console.error('[Polls] Poll not found');
			return false;
		}

		if (poll.isClosed) {
			console.error('[Polls] Poll is closed');
			return false;
		}

		if (poll.userVote !== undefined) {
			console.error('[Polls] Already voted');
			return false;
		}

		try {
			const event = new NDKEvent(ndkService.ndk);
			event.kind = VOTE_KIND;
			event.content = '';
			event.tags = [
				['e', pollId],
				['response', optionIndex.toString()]
			];

			await event.sign();
			await event.publish();

			console.log('[Polls] Vote submitted:', event.id);

			// Update local state optimistically
			const updatedOptions = poll.options.map((opt) =>
				opt.index === optionIndex ? { ...opt, votes: opt.votes + 1 } : opt
			);

			polls.set(pollId, {
				...poll,
				options: updatedOptions,
				totalVotes: poll.totalVotes + 1,
				userVote: optionIndex
			});

			polls = new Map(polls);

			return true;
		} catch (e) {
			console.error('[Polls] Failed to vote:', e);
			return false;
		}
	}

	/** Load poll by ID */
	async function loadPoll(pollId: string): Promise<Poll | null> {
		// Check if already loaded
		if (polls.has(pollId)) {
			// Refresh votes
			await fetchVotes(pollId);
			return polls.get(pollId) || null;
		}

		try {
			const event = await ndkService.ndk.fetchEvent({ ids: [pollId] });
			if (!event || event.kind !== POLL_KIND) {
				return null;
			}

			const poll = parsePollEvent(event);
			if (poll) {
				polls.set(pollId, poll);
				polls = new Map(polls);
				await fetchVotes(pollId);
				return polls.get(pollId) || null;
			}

			return null;
		} catch (e) {
			console.error('[Polls] Failed to load poll:', e);
			return null;
		}
	}

	/** Subscribe to polls in feed */
	function subscribeToPolls(): void {
		if (activeSubscription) {
			activeSubscription.stop();
		}

		const filter = {
			kinds: [POLL_KIND],
			limit: 50
		};

		activeSubscription = ndkService.ndk.subscribe(filter, { closeOnEose: false });

		activeSubscription.on('event', (event) => {
			const poll = parsePollEvent(event);
			if (poll && !polls.has(event.id)) {
				polls.set(event.id, poll);
				polls = new Map(polls);
				// Fetch votes asynchronously
				void fetchVotes(event.id);
			}
		});
	}

	/** Stop subscription */
	function unsubscribe(): void {
		if (activeSubscription) {
			activeSubscription.stop();
			activeSubscription = null;
		}
	}

	/** Check if event is a poll */
	function isPollEvent(event: NDKEvent): boolean {
		return event.kind === POLL_KIND;
	}

	/** Get poll from event if it's a poll */
	function getPollFromEvent(event: NDKEvent): Poll | null {
		if (!isPollEvent(event)) return null;

		// Check cache first
		const cached = polls.get(event.id);
		if (cached) {
			return cached;
		}

		// Parse and cache
		const poll = parsePollEvent(event);
		if (poll) {
			polls.set(event.id, poll);
			polls = new Map(polls);
			// Fetch votes asynchronously
			void fetchVotes(event.id);
		}

		return poll;
	}

	/** Get vote percentage for an option */
	function getVotePercentage(poll: Poll, optionIndex: number): number {
		if (poll.totalVotes === 0) return 0;
		const option = poll.options.find((o) => o.index === optionIndex);
		return option ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
	}

	return {
		// State
		get polls() {
			return polls;
		},
		get isLoading() {
			return isLoading;
		},

		// Actions
		createPoll,
		vote,
		loadPoll,
		fetchVotes,
		subscribeToPolls,
		unsubscribe,

		// Utilities
		isPollEvent,
		getPollFromEvent,
		getVotePercentage,

		// Constants
		POLL_KIND,
		VOTE_KIND
	};
}

/** Polls store singleton */
export const pollsStore = createPollsStore();

export default pollsStore;
