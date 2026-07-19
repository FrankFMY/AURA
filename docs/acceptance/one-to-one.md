# AURA one-to-one physical acceptance

Use this checklist before every production release that changes custody, messaging, navigation, mobile layout, clipboard, relays, storage or service-worker behavior.

## Safety rules

- Use dedicated test identities. Never expose a real Recovery Code in screenshots, recordings or issue attachments.
- Never paste a private invitation into logs, tickets, analytics or HTTP query parameters.
- Redact full npubs unless exact identity comparison is the purpose of the test.
- `Copy diagnostics` is the only support artifact approved by default. Review it before sharing.
- A relay acknowledgement means network acceptance, not recipient delivery or reading.

## Device matrix

Record exact device, OS and browser/PWA mode.

| Surface  | Minimum acceptance                                 |
| -------- | -------------------------------------------------- |
| iPhone   | Current iOS Safari and installed PWA               |
| Android  | Current Chrome and installed PWA                   |
| Desktop  | Chromium plus Safari on macOS when available       |
| Accounts | Two dedicated identities with independent Passkeys |

## First-run and custody

- [ ] Landing fits without horizontal overflow or clipped primary action.
- [ ] Create profile requires user-verified Passkey/PRF support and fails closed otherwise.
- [ ] Recovery Code contains exactly 24 words and confirmation checks the requested positions.
- [ ] Lock removes decrypted messages, drafts, invite plaintext, clipboard success state and DOM references.
- [ ] Reload returns to unlock; it never silently keeps the secret unlocked.
- [ ] Restore with the 24 words produces the exact same npub.
- [ ] Removing a local profile deletes the physical account database before registry metadata disappears.

## Invitation and identity

- [ ] Copy invitation produces an `/i/#...` fragment URL.
- [ ] The fragment never appears in HTTP requests, `Referer`, logs or diagnostics.
- [ ] Opening a valid invitation states that the display name is self-declared.
- [ ] Expired, wrong-origin, malformed and altered invitations fail closed.
- [ ] The invite path creates or unlocks safely, then pre-opens the expected conversation.
- [ ] Manual npub entry exists only inline in Chats; there is no separate New chat tab.

## Device linking

Use an existing profile on the source and an empty browser profile on the target.

- [ ] Target creates a `/link/#...` QR locally and shows a six-digit verification code.
- [ ] Cancelling the target request returns to first-run; the old QR can no longer complete linking.
- [ ] Source scans inside AURA using the live camera.
- [ ] QR-image upload decodes the same request when camera access is unavailable.
- [ ] Paste-link fallback works inside the already unlocked source profile.
- [ ] System-camera deep link clears its fragment; without a trusted local profile it imports nothing.
- [ ] The fragment never appears in HTTP requests, `Referer`, logs or diagnostics.
- [ ] Both devices show the same six-digit code before approval.
- [ ] Source approval performs a fresh Face ID/Passkey prompt even while the profile is unlocked.
- [ ] Target shows the received display name and npub before persistence.
- [ ] Target creates a fresh local Passkey; no Recovery Code is shown or copied.
- [ ] Linked target npub exactly matches the source npub.
- [ ] A sender-copy message written before linking reappears after target relay replay.
- [ ] Expired, altered, wrong-origin, unsupported-relay and replayed requests fail closed.
- [ ] Closing, locking or unmounting either flow removes pairing UI and cannot apply stale completion.

## Chat list and navigation

- [ ] Primary navigation contains only Chats and Profile.
- [ ] The plus button opens the inline contact form and focuses the identifier field.
- [ ] Cancel closes only the inline form and does not lose an existing conversation draft.
- [ ] Empty inbox and desktop conversation empty state are visually centered.
- [ ] Opening a chat on mobile hides global navigation until Back is pressed.

## Composer and viewport

- [ ] Desktop Enter sends; Shift+Enter inserts a newline.
- [ ] Mobile Enter inserts a newline; Send button sends.
- [ ] IME composition and legacy Safari keyCode 229 never trigger send.
- [ ] Composer grows to at most 144 px and then scrolls internally.
- [ ] Opening the keyboard keeps the header at the visual viewport top.
- [ ] Composer stays within 0–16 px of the keyboard boundary.
- [ ] No global navigation appears between composer and keyboard.
- [ ] Closing the keyboard restores safe-area spacing without a jump.
- [ ] No horizontal overflow at 320×640, 390×844 and 412×915.

## Messaging and storage

Run each direction: A→B and B→A.

- [ ] A text message appears immediately from durable local state.
- [ ] Recipient receives and decrypts the exact content.
- [ ] Sender copy restores the outgoing message after local database recreation/recovery.
- [ ] Duplicate Gift Wrap delivery creates only one logical message.
- [ ] Reload during send does not lose or mutate the exact event.
- [ ] Offline send remains queued and publishes after reconnect.
- [ ] One unavailable relay does not corrupt state or block accepted evidence from another intended relay.
- [ ] Relay rejection is not displayed as recipient delivery.
- [ ] Drafts remain isolated per conversation.
- [ ] Opening/reopening a conversation lands at the latest message.
- [ ] New messages auto-follow only when already near the end; otherwise the unseen chip appears.

## Lifecycle races

- [ ] Lock while send is pending cannot apply stale success/error UI.
- [ ] Lock while clipboard write is pending cannot apply stale copied state.
- [ ] Lock while diagnostics collection/write is pending cannot apply stale notice.
- [ ] Switching conversation during refresh cannot render the previous conversation’s messages.
- [ ] Stopping runtime closes active subscriptions and ignores late event/EOSE/close callbacks.
- [ ] Reload/unmount clears visualViewport listeners and root keyboard attributes.

## Diagnostics

- [ ] Copy diagnostics produces valid `aura-local-diagnostics-v1` JSON.
- [ ] It includes only connection, recovery confirmation, schema and aggregate table/outbox counts.
- [ ] It contains no full pubkey, relay URL, event JSON, message content, invite token, user agent or error reason.
- [ ] Clipboard rejection produces a bounded user-facing error and no unhandled page error.

## Release evidence

Record:

```text
Commit:
Release path:
iPhone device / OS / mode:
Android device / OS / mode:
Desktop browser:
A→B message PASS/FAIL:
B→A message PASS/FAIL:
Offline/reconnect PASS/FAIL:
Lock/reload PASS/FAIL:
Invite fragment leak check PASS/FAIL:
Device-link QR scan PASS/FAIL:
Device-link fresh source verification PASS/FAIL:
Linked exact npub PASS/FAIL:
Linked history replay PASS/FAIL:
Device-link fragment leak check PASS/FAIL:
Diagnostics redaction PASS/FAIL:
Known limitations:
```

A release is blocked by any confirmed message loss, secret/custody regression, stale post-lock state, invitation leak, database migration failure or unusable mobile conversation layout.
