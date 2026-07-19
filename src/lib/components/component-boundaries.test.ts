import { describe, expect, it } from 'vitest';

const COMPONENTS = ['ChatListPane', 'ConversationPane', 'ProfilePane'] as const;
const sources = import.meta.glob('./*.svelte', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

describe('messenger component boundaries', () => {
	it.each(COMPONENTS)('keeps %s in its own component', (component) => {
		const componentSource = sources[`./${component}.svelte`];
		expect(componentSource).toBeTypeOf('string');
		expect(componentSource).toContain('$props()');
	});

	it('keeps pane markup out of the lifecycle owner', () => {
		const appSource = sources['./App.svelte'];
		for (const component of COMPONENTS) {
			expect(appSource).toContain(`import ${component} from './${component}.svelte'`);
			expect(appSource).toContain(`<${component}`);
		}
		expect(appSource).not.toContain('class="chat-list-pane"');
		expect(appSource).not.toContain('class="conversation-pane"');
		expect(appSource).not.toContain('class="profile-content"');
	});

	it('keeps custody, storage, and runtime objects out of presentation panes', () => {
		for (const component of COMPONENTS) {
			const componentSource = sources[`./${component}.svelte`];
			expect(componentSource).not.toMatch(/\$lib\/(?:custody|storage|nostr\/messenger-runtime)/u);
		}

		const profileSource = sources['./ProfilePane.svelte'];
		expect(profileSource).not.toMatch(/RegisteredAccount|KeyEnvelope|credential_id|\baccount\s*:/u);
		const appSource = sources['./App.svelte'];
		expect(appSource).not.toMatch(/<ProfilePane[\s\S]{0,320}\{account\}/u);
	});

	it('passes reactive presentation labels explicitly instead of hidden callback dependencies', () => {
		const chatListSource = sources['./ChatListPane.svelte'];
		const conversationSource = sources['./ConversationPane.svelte'];
		expect(chatListSource).toContain('chat.label');
		expect(chatListSource).not.toContain('contactLabel:');
		expect(conversationSource).toContain('conversationLabel');
		expect(conversationSource).not.toContain('contactLabel:');
	});
});
