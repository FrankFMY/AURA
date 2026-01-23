import { describe, it, expect } from 'vitest';
import { sanitizeHtml, escapeHtml, parseNoteContent, sanitizeUrl } from '$lib/validators/sanitize';

describe('sanitize utilities', () => {
	describe('escapeHtml', () => {
		it('should escape HTML entities', () => {
			expect(escapeHtml('<script>alert("xss")</script>')).toBe(
				'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
			);
		});

		it('should handle empty strings', () => {
			expect(escapeHtml('')).toBe('');
		});

		it('should handle strings without special characters', () => {
			expect(escapeHtml('Hello World')).toBe('Hello World');
		});
	});

	describe('sanitizeHtml', () => {
		it('should remove script tags', () => {
			const result = sanitizeHtml('<script>alert("xss")</script>Hello');
			expect(result).not.toContain('<script>');
			expect(result).toContain('Hello');
		});

		it('should allow safe tags', () => {
			const result = sanitizeHtml('<a href="https://example.com">Link</a>', 'note');
			expect(result).toContain('<a');
			expect(result).toContain('href');
		});

		it('should handle empty input', () => {
			expect(sanitizeHtml('')).toBe('');
		});
	});

	describe('parseNoteContent', () => {
		it('should extract hashtags', () => {
			const result = parseNoteContent('Hello #nostr #bitcoin');
			expect(result.hashtags).toContain('nostr');
			expect(result.hashtags).toContain('bitcoin');
		});

		it('should handle empty content', () => {
			const result = parseNoteContent('');
			expect(result.html).toBe('');
			expect(result.urls).toHaveLength(0);
		});

		it('should convert hashtags to links', () => {
			const result = parseNoteContent('Hello #nostr');
			expect(result.html).toContain('href="/search?q=%23nostr"');
		});

		it('should return arrays for urls and imageUrls', () => {
			const result = parseNoteContent('Some text');
			expect(Array.isArray(result.urls)).toBe(true);
			expect(Array.isArray(result.imageUrls)).toBe(true);
		});
	});

	describe('sanitizeUrl', () => {
		it('should allow https URLs', () => {
			expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
		});

		it('should allow wss URLs', () => {
			expect(sanitizeUrl('wss://relay.example.com')).toBe('wss://relay.example.com/');
		});

		it('should reject javascript URLs', () => {
			expect(sanitizeUrl('javascript:alert(1)')).toBe('');
		});

		it('should reject data URLs', () => {
			expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
		});

		it('should handle invalid URLs', () => {
			expect(sanitizeUrl('not a url')).toBe('');
		});
	});
});
