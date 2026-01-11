import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with clsx */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Format timestamp to relative time (e.g., "2h ago") */
export function formatRelativeTime(timestamp: number): string {
	const now = Math.floor(Date.now() / 1000);
	const diff = now - timestamp;

	if (diff < 60) return 'just now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

	const date = new Date(timestamp * 1000);
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format number with K/M suffixes */
export function formatNumber(num: number): string {
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
	return num.toString();
}

/** Truncate public key for display */
export function truncatePubkey(pubkey: string, length: number = 8): string {
	if (!pubkey || pubkey.length < length * 2) return pubkey;
	return `${pubkey.slice(0, length)}...${pubkey.slice(-length)}`;
}

/** Convert npub to hex and vice versa */
export function isHexKey(key: string): boolean {
	return /^[0-9a-fA-F]{64}$/.test(key);
}

/** Debounce function */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn(...args), delay);
	};
}

/** Sleep utility */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate random ID */
export function generateId(): string {
	return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/** Safe JSON parse */
export function safeJsonParse<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}

/** Extract URLs from text */
export function extractUrls(text: string): string[] {
	const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
	return text.match(urlRegex) || [];
}

/** Check if URL is an image */
export function isImageUrl(url: string): boolean {
	const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
	const lowercaseUrl = url.toLowerCase();
	return imageExtensions.some((ext) => lowercaseUrl.includes(ext));
}

/** Extract hashtags from text */
export function extractHashtags(text: string): string[] {
	const hashtagRegex = /#(\w+)/g;
	const matches = text.match(hashtagRegex);
	return matches ? matches.map((tag) => tag.slice(1)) : [];
}

/** Copy text to clipboard */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Fallback for older browsers
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		const success = document.execCommand('copy');
		document.body.removeChild(textarea);
		return success;
	}
}
