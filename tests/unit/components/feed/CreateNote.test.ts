import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CreateNote from '$lib/components/feed/CreateNote.svelte';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

// Hoist the mock function so it can be used inside vi.mock factory
const { mockPublishNote } = vi.hoisted(() => {
	return { mockPublishNote: vi.fn(() => Promise.resolve()) };
});

// Mock the stores
vi.mock('$stores/feed.svelte', () => ({
	feedStore: {
		publishNote: mockPublishNote
	}
}));

vi.mock('$stores/auth.svelte', () => ({
	authStore: {
		avatar: 'test-avatar.jpg',
		displayName: 'Test User'
	}
}));

describe('CreateNote.svelte', () => {
	beforeEach(() => {
		// mockPublishNote.mockClear() is also an option if you don't need to reset implementations
		mockPublishNote.mockReset().mockResolvedValue(undefined);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should render the component and handle text input', async () => {
		render(CreateNote, { placeholder: "What's new?" });

		const postButton = screen.getByRole('button', { name: /Post/i });
		const textarea = screen.getByPlaceholderText("What's new?");

		// Button should be disabled initially
		expect(postButton).toBeDisabled();

		// Simulate typing in the textarea
		await fireEvent.input(textarea, { target: { value: 'Hello world' } });

		// Button should be enabled now
		expect(postButton).not.toBeDisabled();

		// Character count should be updated (component uses "chars" abbreviation)
		expect(screen.getByText(/11 chars/)).toBeInTheDocument();
	});

	it('should call feedStore.publishNote on button click and clear the textarea', async () => {
		render(CreateNote);
		const postButton = screen.getByRole('button', { name: /Post/i });
		const textarea = screen.getByPlaceholderText("What's on your mind?");

		// Type content
		const testContent = 'This is a test note.';
		await fireEvent.input(textarea, { target: { value: testContent } });
		expect(postButton).not.toBeDisabled();

		// Click the post button
		await fireEvent.click(postButton);

		// Check that publishNote was called correctly
		expect(mockPublishNote).toHaveBeenCalledTimes(1);
		expect(mockPublishNote).toHaveBeenCalledWith(testContent, undefined);

		// After the promise resolves, the textarea should be cleared
		// We need to wait for the `try/catch/finally` block in the component
		await vi.runAllTimersAsync(); // Allow async operations to complete

		expect((textarea as HTMLTextAreaElement).value).toBe('');
	});

	it('should call feedStore.publishNote on Ctrl+Enter', async () => {
		render(CreateNote);
		const textarea = screen.getByPlaceholderText("What's on your mind?");
		const testContent = 'Submitting with keyboard shortcut.';
		
		await fireEvent.input(textarea, { target: { value: testContent } });
		
		// Simulate Ctrl+Enter
		await fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
		
		expect(mockPublishNote).toHaveBeenCalledTimes(1);
		expect(mockPublishNote).toHaveBeenCalledWith(testContent, undefined);
	});

	it('should handle API errors gracefully', async () => {
		// Mock the publish function to reject
		mockPublishNote.mockRejectedValueOnce(new Error('Network Failed'));
		
		render(CreateNote);
		const postButton = screen.getByRole('button', { name: /Post/i });
		const textarea = screen.getByPlaceholderText("What's on your mind?");

		await fireEvent.input(textarea, { target: { value: 'This will fail' } });
		await fireEvent.click(postButton);

		// Wait for the error handling to complete
		await vi.runAllTimersAsync();

		// Check that the error message is displayed
		const errorElement = await screen.findByText('Network Failed');
		expect(errorElement).toBeInTheDocument();
		
		// The textarea should NOT be cleared
		expect((textarea as HTMLTextAreaElement).value).toBe('This will fail');
	});

	it('should correctly pass a replyTo event', async () => {
		const mockReplyEvent = { id: 'reply-to-id' } as NDKEvent;
		render(CreateNote, { replyTo: mockReplyEvent });

		const textarea = screen.getByPlaceholderText("What's on your mind?");
		const testContent = 'This is a reply.';

		await fireEvent.input(textarea, { target: { value: testContent } });
		await fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

		expect(mockPublishNote).toHaveBeenCalledWith(testContent, mockReplyEvent);
	});
});
