/**
 * Patch @noble/* package exports for Vite compatibility
 * 
 * @noble/curves v2.0.1 and @noble/hashes v2.0.1 use strict ESM exports
 * with .js extensions. Some dependencies (nostr-tools) import without
 * the .js extension, causing build failures.
 * 
 * This script adds extensionless exports to fix the issue.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeModules = join(__dirname, '..', 'node_modules');

function patchPackageAtPath(pkgPath, additionalExports) {
	if (!existsSync(pkgPath)) {
		return false;
	}
	
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
		
		if (!pkg.exports) {
			pkg.exports = {};
		}
		
		let patched = 0;
		for (const [key, value] of Object.entries(additionalExports)) {
			if (!pkg.exports[key]) {
				pkg.exports[key] = value;
				patched++;
			}
		}
		
		if (patched > 0) {
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
			return patched;
		}
		return 0;
	} catch (err) {
		console.error(`❌ Failed to patch ${pkgPath}:`, err.message);
		return -1;
	}
}

/** Check if path is a directory */
function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Process nested node_modules in a package directory */
function collectNestedPaths(pkgPath, pkgName, visited) {
	const nestedNodeModules = join(pkgPath, 'node_modules');
	if (existsSync(nestedNodeModules)) {
		return findAllPackagePaths(nestedNodeModules, pkgName, visited);
	}
	return [];
}

/** Process scoped packages (@org/pkg) */
function processScopedPackage(scopePath, pkgName, visited) {
	const paths = [];
	try {
		const scopedEntries = readdirSync(scopePath);
		for (const scopedEntry of scopedEntries) {
			const scopedPkgPath = join(scopePath, scopedEntry);
			paths.push(...collectNestedPaths(scopedPkgPath, pkgName, visited));
		}
	} catch {
		// Ignore read errors
	}
	return paths;
}

/** Process a single entry in node_modules */
function processNodeModulesEntry(nodeModulesPath, entry, pkgName, visited) {
	if (entry.startsWith('.')) return [];

	const entryPath = join(nodeModulesPath, entry);
	if (!isDirectory(entryPath)) return [];

	if (entry.startsWith('@')) {
		return processScopedPackage(entryPath, pkgName, visited);
	}
	return collectNestedPaths(entryPath, pkgName, visited);
}

function findAllPackagePaths(nodeModulesPath, pkgName, visited = new Set()) {
	const paths = [];

	// Prevent infinite loops
	if (visited.has(nodeModulesPath)) return paths;
	visited.add(nodeModulesPath);

	// Direct path
	const directPath = join(nodeModulesPath, pkgName, 'package.json');
	if (existsSync(directPath)) {
		paths.push(directPath);
	}

	// Check nested node_modules in each package
	try {
		const entries = readdirSync(nodeModulesPath);
		for (const entry of entries) {
			paths.push(...processNodeModulesEntry(nodeModulesPath, entry, pkgName, visited));
		}
	} catch {
		// Silently ignore errors from reading directories
	}

	return paths;
}

function patchPackage(pkgName, additionalExports) {
	const allPaths = findAllPackagePaths(nodeModules, pkgName);
	
	// Also check known problematic nested locations explicitly
	const knownNestedPaths = [
		// Direct nested in main packages
		join(nodeModules, 'nostr-tools', 'node_modules', pkgName, 'package.json'),
		join(nodeModules, '@nostr-dev-kit', 'ndk', 'node_modules', pkgName, 'package.json'),
		join(nodeModules, '@cashu', 'cashu-ts', 'node_modules', pkgName, 'package.json'),
		join(nodeModules, '@scure', 'bip32', 'node_modules', pkgName, 'package.json'),
		join(nodeModules, '@scure', 'bip39', 'node_modules', pkgName, 'package.json'),
		// Deeply nested paths
		join(nodeModules, 'nostr-tools', 'node_modules', '@scure', 'bip32', 'node_modules', pkgName, 'package.json'),
		join(nodeModules, 'nostr-tools', 'node_modules', '@scure', 'bip39', 'node_modules', pkgName, 'package.json'),
		join(nodeModules, 'nostr-tools', 'node_modules', '@noble', 'curves', 'node_modules', pkgName, 'package.json'),
	];
	
	for (const knownPath of knownNestedPaths) {
		if (existsSync(knownPath) && !allPaths.includes(knownPath)) {
			allPaths.push(knownPath);
		}
	}
	
	if (allPaths.length === 0) {
		console.log(`⚠️  ${pkgName} not found, skipping`);
		return;
	}
	
	let totalPatched = 0;
	for (const pkgPath of allPaths) {
		const result = patchPackageAtPath(pkgPath, additionalExports);
		if (result > 0) {
			totalPatched += result;
			console.log(`✅ Patched ${pkgPath.replace(nodeModules, 'node_modules')} (+${result} exports)`);
		}
	}
	
	if (totalPatched === 0) {
		console.log(`✓  ${pkgName} already patched (${allPaths.length} locations)`);
	}
}

// Patch @noble/hashes
patchPackage('@noble/hashes', {
	'./utils': './utils.js',
	'./sha256': './sha256.js',
	'./sha512': './sha512.js',
	'./hmac': './hmac.js',
	'./hkdf': './hkdf.js',
	'./pbkdf2': './pbkdf2.js',
	'./ripemd160': './ripemd160.js',
	'./sha3': './sha3.js',
	'./blake2s': './blake2s.js',
	'./blake2b': './blake2b.js',
	'./sha1': './sha1.js',
	'./crypto': './crypto.js'
});

// Patch @noble/curves
patchPackage('@noble/curves', {
	'./secp256k1': './secp256k1.js',
	'./ed25519': './ed25519.js',
	'./ed448': './ed448.js',
	'./nist': './nist.js',
	'./utils': './utils.js',
	'./webcrypto': './webcrypto.js',
	'./abstract/weierstrass': './abstract/weierstrass.js',
	'./abstract/modular': './abstract/modular.js',
	'./abstract/utils': './abstract/utils.js',
	'./abstract/curve': './abstract/curve.js',
	'./abstract/edwards': './abstract/edwards.js',
	'./abstract/hash-to-curve': './abstract/hash-to-curve.js',
	'./abstract/montgomery': './abstract/montgomery.js',
	'./abstract/bls': './abstract/bls.js',
	'./abstract/poseidon': './abstract/poseidon.js'
});

// Patch @noble/ciphers if present
patchPackage('@noble/ciphers', {
	'./utils': './utils.js',
	'./chacha': './chacha.js',
	'./aes': './aes.js',
	'./webcrypto': './webcrypto.js'
});

// Clean Vite cache to ensure fresh resolution
const viteCachePath = join(nodeModules, '.vite');
if (existsSync(viteCachePath)) {
	try {
		const { rmSync } = await import('node:fs');
		rmSync(viteCachePath, { recursive: true, force: true });
		console.log('🗑️  Cleared Vite cache');
	} catch (err) {
		console.log('⚠️  Could not clear Vite cache:', err.message);
	}
}

// Verify critical exports
const criticalPkgPath = join(nodeModules, '@noble', 'hashes', 'package.json');
if (existsSync(criticalPkgPath)) {
	try {
		const pkg = JSON.parse(readFileSync(criticalPkgPath, 'utf8'));
		const hasShaCritical = pkg.exports && pkg.exports['./sha256'];
		if (hasShaCritical) {
			console.log('✓  Verified @noble/hashes has ./sha256 export');
		} else {
			console.log('⚠️  WARNING: @noble/hashes missing ./sha256 export!');
		}
	} catch (err) {
		console.log('⚠️  Could not verify @noble/hashes:', err.message);
	}
}

console.log('\n🔧 Noble packages patched for Vite compatibility');
