import { expect, test, type Page } from '@playwright/test';
import { createInviteToken, generateInviteNonce } from '../src/lib/core/invite';
import { generateSecretKey, getPublicKey, type Event, type Filter } from 'nostr-tools';
import { createDmRelayList } from '../src/lib/nostr/dm-relays';

const ORIGIN = 'http://127.0.0.1:4173';
const INVITER_SECRET = generateSecretKey();

interface RoutedSocket {
	send(message: string): void;
	onMessage(handler: (message: string) => void): void;
	onClose(handler: () => void): void;
	close(options?: { code?: number; reason?: string }): void;
}

interface RelayClient {
	socket: RoutedSocket;
	subscriptions: Map<string, Filter[]>;
}

function matchesFilter(event: Event, filter: Filter): boolean {
	if (filter.ids && !filter.ids.some((id) => event.id.startsWith(id))) return false;
	if (filter.authors && !filter.authors.some((author) => event.pubkey.startsWith(author)))
		return false;
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
	if (filter.since !== undefined && event.created_at < filter.since) return false;
	if (filter.until !== undefined && event.created_at > filter.until) return false;
	for (const [key, values] of Object.entries(filter)) {
		if (!key.startsWith('#') || !Array.isArray(values)) continue;
		const tagName = key.slice(1);
		const acceptedValues = values as readonly unknown[];
		if (
			!event.tags.some(
				(tag) => tag[0] === tagName && acceptedValues.some((value) => value === tag[1])
			)
		) {
			return false;
		}
	}
	return true;
}

class RelayHarness {
	readonly events = new Map<string, Event>();
	readonly clients = new Set<RelayClient>();

	connect(socket: RoutedSocket): void {
		const client: RelayClient = { socket, subscriptions: new Map() };
		this.clients.add(client);
		socket.onMessage((message) => this.receive(client, String(message)));
		socket.onClose(() => this.clients.delete(client));
	}

	close(): void {
		for (const client of this.clients) {
			client.socket.close({ code: 1000, reason: 'test relay teardown' });
		}
		this.clients.clear();
	}

	private receive(client: RelayClient, raw: string): void {
		const frame = JSON.parse(raw) as unknown[];
		if (frame[0] === 'REQ' && typeof frame[1] === 'string') {
			const subscriptionId = frame[1];
			const filters = frame.slice(2) as Filter[];
			client.subscriptions.set(subscriptionId, filters);
			for (const event of this.events.values()) {
				if (filters.some((filter) => matchesFilter(event, filter))) {
					client.socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
				}
			}
			client.socket.send(JSON.stringify(['EOSE', subscriptionId]));
			return;
		}
		if (frame[0] === 'CLOSE' && typeof frame[1] === 'string') {
			client.subscriptions.delete(frame[1]);
			return;
		}
		if (frame[0] !== 'EVENT' || typeof frame[1] !== 'object' || frame[1] === null) return;
		const event = frame[1] as Event;
		this.events.set(event.id, event);
		client.socket.send(JSON.stringify(['OK', event.id, true, 'stored by test relay']));
		for (const recipient of this.clients) {
			for (const [subscriptionId, filters] of recipient.subscriptions) {
				if (filters.some((filter) => matchesFilter(event, filter))) {
					recipient.socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
				}
			}
		}
	}
}

async function installBrowserCustody(page: Page, seed: number): Promise<void> {
	await page.addInitScript((credentialSeed) => {
		const credentialId = new Uint8Array(32).fill(credentialSeed);
		const prfOutput = new Uint8Array(32).fill(credentialSeed + 31);
		const credential = {
			id: `aura-device-link-${credentialSeed}`,
			rawId: credentialId.buffer,
			type: 'public-key',
			authenticatorAttachment: 'platform',
			response: {},
			getClientExtensionResults: () => ({
				prf: { enabled: true, results: { first: prfOutput.buffer } }
			}),
			toJSON: () => ({})
		};
		class MockPublicKeyCredential {
			static async isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> {
				return true;
			}
		}
		Object.defineProperty(window, 'PublicKeyCredential', {
			configurable: true,
			value: MockPublicKeyCredential
		});
		Object.defineProperty(navigator, 'credentials', {
			configurable: true,
			value: {
				create: async () => {
					const state = window as typeof window & { __auraCredentialCreates?: number };
					state.__auraCredentialCreates = (state.__auraCredentialCreates ?? 0) + 1;
					return credential;
				},
				get: async () => {
					const state = window as typeof window & { __auraCredentialGets?: number };
					state.__auraCredentialGets = (state.__auraCredentialGets ?? 0) + 1;
					return credential;
				}
			}
		});
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					(window as typeof window & { __auraClipboard?: string }).__auraClipboard = value;
				}
			}
		});
	}, seed);
}

async function attachRelay(page: Page, relay: RelayHarness): Promise<void> {
	await page.routeWebSocket(/wss:\/\//u, (socket) => relay.connect(socket));
}

async function activeRegistryPubkey(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			new Promise<string>((resolve, reject) => {
				const open = indexedDB.open('aura-r1:registry');
				open.onerror = () => reject(open.error ?? new Error('registry open failed'));
				open.onsuccess = () => {
					const database = open.result;
					const transaction = database.transaction('settings', 'readonly');
					const request = transaction.objectStore('settings').get('active-account');
					request.onerror = () => reject(request.error ?? new Error('active account lookup failed'));
					request.onsuccess = () => {
						const value = (request.result as { value?: unknown } | undefined)?.value;
						database.close();
						if (typeof value === 'string') resolve(value);
						else reject(new Error('active account is missing'));
					};
				};
			})
	);
}

function invitationToken(): string {
	const now = Math.floor(Date.now() / 1000);
	return createInviteToken(
		{
			v: 1,
			action: 'dm',
			origin: ORIGIN,
			issuer_pubkey: getPublicKey(INVITER_SECRET),
			display: { name: 'History peer' },
			relay_hints: ['wss://nos.lol/'],
			issued_at: now - 1,
			expires_at: now + 3600,
			nonce: generateInviteNonce()
		},
		INVITER_SECRET
	);
}

async function confirmRecovery(page: Page): Promise<void> {
	const words = await page.locator('.word-grid li').allTextContents();
	for (const index of [3, 11, 20]) {
		const word = words[index]?.replace(/^\s*\d+\s*/u, '').trim();
		if (!word) throw new Error(`Recovery word ${index + 1} is missing`);
		await page.getByLabel(`Word ${index + 1}`).fill(word);
	}
	await page.getByRole('button', { name: /I saved it safely/i }).click();
}

test('links the exact identity into isolated storage and restores pre-link relay history', async ({
	browser
}, testInfo) => {
	test.setTimeout(90_000);
	const relay = new RelayHarness();
	const inviterRelayList = createDmRelayList(
		INVITER_SECRET,
		['wss://relay.damus.io/', 'wss://nos.lol/'],
		Math.floor(Date.now() / 1000)
	);
	relay.events.set(inviterRelayList.id, inviterRelayList);
	const sourceContext = await browser.newContext();
	const targetContext = await browser.newContext();
	const source = await sourceContext.newPage();
	const target = await targetContext.newPage();
	await installBrowserCustody(source, 7);
	await installBrowserCustody(target, 13);
	await attachRelay(source, relay);
	await attachRelay(target, relay);

	await source.goto(`/i/#${invitationToken()}`);
	await source.getByRole('button', { name: /Create secure profile/i }).click();
	await source.getByLabel('Display name').fill('Linked source');
	await source.getByRole('button', { name: /Continue with Passkey/i }).click();
	await expect(source.getByRole('heading', { name: /Save your Recovery Code/i })).toBeVisible();
	await confirmRecovery(source);
	const composer = source.getByRole('textbox', { name: 'Message', exact: true });
	await expect(composer).toBeVisible({ timeout: 15_000 });
	await composer.fill('message written before device linking');
	await source.getByRole('button', { name: 'Send message' }).click();
	await expect(
		source.getByText('message written before device linking', { exact: true })
	).toBeVisible();

	await source.getByRole('button', { name: 'Profile' }).click();
	const sourceIdentityLabel = (await source.locator('.profile-title .mono').textContent())?.trim();
	expect(sourceIdentityLabel).toBeTruthy();
	const sourcePubkey = await activeRegistryPubkey(source);
	expect(sourcePubkey).toMatch(/^[0-9a-f]{64}$/u);

	await target.goto('/');
	await target.getByRole('button', { name: /Link an existing profile/i }).click();
	await expect(target.getByRole('img', { name: /one-time AURA device-link QR/i })).toBeVisible();
	await target.getByRole('button', { name: /Cancel device linking/i }).click();
	await expect(target.getByRole('heading', { name: /Your people/i })).toBeVisible();

	await target.getByRole('button', { name: /Link an existing profile/i }).click();
	const targetQr = target.getByRole('img', { name: /one-time AURA device-link QR/i });
	await expect(targetQr).toBeVisible();
	const qrImagePath = testInfo.outputPath('device-link-qr.png');
	await targetQr.screenshot({ path: qrImagePath });
	const targetCode = (await target.locator('.link-code-block strong').textContent())?.trim();
	expect(targetCode).toMatch(/^\d{6}$/u);
	await target.getByRole('button', { name: /Copy link instead/i }).click();
	const linkUrl = await target.evaluate(
		() => (window as typeof window & { __auraClipboard?: string }).__auraClipboard
	);
	expect(linkUrl).toMatch(/^http:\/\/127\.0\.0\.1:4173\/link\/#/u);

	await source.getByRole('button', { name: /Link another device/i }).click();
	const closeLinkDialog = source.getByRole('button', { name: /Close device linking/i });
	await expect(closeLinkDialog).toBeFocused();
	await source.keyboard.press('Escape');
	await expect(source.getByRole('dialog')).toHaveCount(0);
	await expect(source.getByRole('button', { name: /Link another device/i })).toBeFocused();
	await source.getByRole('button', { name: /Link another device/i }).click();
	await source.locator('input[type="file"]').setInputFiles(qrImagePath);
	await expect(source.getByRole('heading', { name: /Link this profile/i })).toBeVisible();
	await expect(source.locator('.link-code-block strong')).toHaveText(targetCode ?? '');
	await source.getByRole('button', { name: /Approve with Passkey/i }).click();
	await expect(source.getByRole('heading', { name: /Finish on the new device/i })).toBeVisible();
	expect(
		await source.evaluate(
			() => (window as typeof window & { __auraCredentialGets?: number }).__auraCredentialGets
		)
	).toBe(1);

	await expect(target.getByRole('heading', { name: /Protect it on this device/i })).toBeVisible({
		timeout: 15_000
	});
	await expect(target.getByText('Linked source', { exact: true })).toBeVisible();
	await target.getByRole('button', { name: /Continue with Passkey/i }).click();
	await expect(target.getByRole('button', { name: 'Profile' })).toBeVisible({ timeout: 15_000 });
	expect(
		await target.evaluate(
			() => (window as typeof window & { __auraCredentialCreates?: number }).__auraCredentialCreates
		)
	).toBe(1);

	await expect(target.locator('.chat-item').first()).toBeVisible({ timeout: 15_000 });
	await target.locator('.chat-item').first().click();
	await expect(
		target.getByText('message written before device linking', { exact: true })
	).toBeVisible({
		timeout: 15_000
	});
	await target.getByRole('button', { name: 'Chats' }).click();
	await target.getByRole('button', { name: 'Profile' }).click();
	await expect(target.locator('.profile-title .mono')).toHaveText(sourceIdentityLabel ?? '');
	const targetPubkey = await activeRegistryPubkey(target);
	expect(targetPubkey).toBe(sourcePubkey);
});
