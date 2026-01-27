import DOMPurify from 'dompurify';

/**
 * Sanitization configuration for different content types
 */
const SANITIZE_CONFIG = {
	/** Basic text content - very restrictive */
	text: {
		ALLOWED_TAGS: [] as string[],
		ALLOWED_ATTR: [] as string[],
		KEEP_CONTENT: true
	},

	/** Note content - allows links and basic formatting */
	note: {
		ALLOWED_TAGS: ['a', 'br', 'p', 'span', 'strong', 'em', 'code', 'pre'] as string[],
		ALLOWED_ATTR: ['href', 'target', 'rel', 'class'] as string[],
		ALLOW_DATA_ATTR: false,
		ADD_ATTR: ['target', 'rel'] as string[],
		FORCE_BODY: true
	},

	/** Profile bio - allows slightly more formatting */
	profile: {
		ALLOWED_TAGS: ['a', 'br', 'p', 'span', 'strong', 'em', 'code', 'ul', 'ol', 'li'] as string[],
		ALLOWED_ATTR: ['href', 'target', 'rel', 'class'] as string[],
		ALLOW_DATA_ATTR: false
	}
};

/**
 * Sanitize HTML content to prevent XSS attacks
 * @param dirty - The potentially unsafe HTML string
 * @param type - The type of content being sanitized
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(
	dirty: string,
	type: keyof typeof SANITIZE_CONFIG = 'note'
): string {
	if (!dirty || typeof dirty !== 'string') {
		return '';
	}

	const config = SANITIZE_CONFIG[type];

	// Configure DOMPurify for links
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		// Set all links to open in new tab with security attributes
		if (node.tagName === 'A') {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});

	const clean = DOMPurify.sanitize(dirty, config);

	// Remove the hook to prevent memory leaks
	DOMPurify.removeHook('afterSanitizeAttributes');

	return clean;
}

/**
 * Escape HTML entities for plain text display
 * @param text - Raw text to escape
 * @returns Escaped text safe for display
 */
export function escapeHtml(text: string): string {
	if (!text || typeof text !== 'string') {
		return '';
	}

	const htmlEntities: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
		'`': '&#x60;'
	};

	return text.replaceAll(/[&<>"'`]/g, (char) => htmlEntities[char]);
}

/**
 * Parse Nostr content and convert to safe HTML
 * Handles URLs, hashtags, mentions, and images
 * @param content - Raw Nostr note content
 * @returns Safe HTML string with clickable links
 */
export function parseNoteContent(content: string): {
	html: string;
	imageUrls: string[];
	urls: string[];
	hashtags: string[];
	mentions: string[];
} {
	if (!content || typeof content !== 'string') {
		return { html: '', imageUrls: [], urls: [], hashtags: [], mentions: [] };
	}

	const imageUrls: string[] = [];
	const urls: string[] = [];
	const hashtags: string[] = [];
	const mentions: string[] = [];

	// Image extensions
	const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;

	// First, escape HTML to prevent XSS
	let escaped = escapeHtml(content);

	// Extract and replace URLs
	const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
	escaped = escaped.replaceAll(urlRegex, (url) => {
		const decodedUrl = url
			.replaceAll('&amp;', '&')
			.replaceAll('&lt;', '<')
			.replaceAll('&gt;', '>')
			.replaceAll('&quot;', '"');

		urls.push(decodedUrl);

		if (imageExtensions.test(decodedUrl)) {
			imageUrls.push(decodedUrl);
			// Return empty string for images - we'll display them separately
			return '';
		}

		// Truncate display URL if too long
		const displayUrl =
			decodedUrl.length > 50 ? decodedUrl.slice(0, 47) + '...' : decodedUrl;

		return `<a href="${escapeHtml(decodedUrl)}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline break-all">${escapeHtml(displayUrl)}</a>`;
	});

	// Extract and replace hashtags
	escaped = escaped.replaceAll(/#(\w+)/g, (match, tag) => {
		hashtags.push(tag);
		return `<a href="/search?q=%23${encodeURIComponent(tag)}" class="text-primary hover:underline">#${escapeHtml(tag)}</a>`;
	});

	// Extract and replace Nostr mentions (npub)
	escaped = escaped.replaceAll(/nostr:(npub1[a-z0-9]{58})/gi, (match, npub) => {
		mentions.push(npub);
		const shortNpub = npub.slice(0, 12) + '...' + npub.slice(-4);
		return `<a href="/profile/${escapeHtml(npub)}" class="text-accent hover:underline">@${shortNpub}</a>`;
	});

	// Extract and replace Nostr note references (note1)
	escaped = escaped.replaceAll(/nostr:(note1[a-z0-9]{58})/gi, (match, noteId) => {
		const shortNote = noteId.slice(0, 12) + '...' + noteId.slice(-4);
		return `<a href="/note/${escapeHtml(noteId)}" class="text-accent hover:underline">📝${shortNote}</a>`;
	});

	// Convert newlines to <br> tags
	escaped = escaped.replaceAll('\n', '<br>');

	// Remove multiple consecutive <br> tags
	escaped = escaped.replaceAll(/(<br\s*\/?>){3,}/gi, '<br><br>');

	// Decode HTML entities in text that shouldn't be encoded for display
	// This fixes issues where entities like &#x2F; (slash) and &#x3D; (equals) are visible
	const decodeEntities = (str: string) => {
		return str
			.replaceAll('&#x2F;', '/')
			.replaceAll('&#x3D;', '=')
			.replaceAll('&#39;', "'")
			.replaceAll('&#x27;', "'")
			.replaceAll('&apos;', "'")
			.replaceAll('&quot;', '"');
	};

	// Final sanitization pass
	const html = sanitizeHtml(escaped, 'note');

	// Unescape safe entities for display
	// We do this AFTER sanitization because we want the browser to render these characters,
	// but we've already ensured (via escapeHtml + DOMPurify) that no malicious tags exist.
	// The problem was that escapeHtml was encoding / and = which aren't dangerous in text context,
	// and then DOMPurify was preserving them as entities.
	return {
		html: decodeEntities(html),
		imageUrls,
		urls,
		hashtags,
		mentions
	};
}

/**
 * Validate and sanitize a URL
 * @param url - URL to validate
 * @returns Sanitized URL or empty string if invalid
 */
export function sanitizeUrl(url: string | undefined | null): string {
	if (!url || typeof url !== 'string') {
		return '';
	}

	try {
		const parsed = new URL(url);

		// Only allow http, https, and wss protocols
		if (!['http:', 'https:', 'wss:'].includes(parsed.protocol)) {
			return '';
		}

		// Force HTTPS for http URLs to avoid mixed content/CSP issues
		if (parsed.protocol === 'http:') {
			parsed.protocol = 'https:';
		}

		return parsed.href;
	} catch {
		return '';
	}
}

/**
 * Strip all HTML tags and return plain text
 * @param html - HTML string
 * @returns Plain text content
 */
export function stripHtml(html: string): string {
	return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
}

export default {
	sanitizeHtml,
	escapeHtml,
	parseNoteContent,
	sanitizeUrl,
	stripHtml
};
