# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to **Pryanishnikovartem@gmail.com** with:

- the affected version or commit;
- reproduction steps;
- expected and observed behavior;
- impact and any suggested mitigation.

Do not include live private keys, Recovery Codes, message content, or credentials. Use a fresh test identity when a proof of concept is necessary.

You should receive an acknowledgement within 72 hours. Confirmed issues will be investigated and fixed before public disclosure whenever practical.

## Supported version

The current production release at [aura.frankfmy.com](https://aura.frankfmy.com) and the latest `main` branch are supported.

## Security boundaries

AURA cannot protect a key after the browser, operating system, extension environment, or device has been compromised. Persistent browser profiles are enabled only when a user-verified WebAuthn PRF operation succeeds. Users remain responsible for keeping their 24-word Recovery Code offline and private.
