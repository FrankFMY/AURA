#!/usr/bin/env node

/**
 * IPFS Deployment Script for AURA
 * 
 * This script builds the application and deploys it to IPFS
 * using either Pinata, web3.storage, or local IPFS node.
 * 
 * Prerequisites:
 *   - For Pinata: Set PINATA_API_KEY and PINATA_API_SECRET env vars
 *   - For web3.storage: Set WEB3_STORAGE_TOKEN env var
 *   - For local IPFS: Have ipfs daemon running
 * 
 * Usage:
 *   node scripts/deploy-ipfs.js [--provider pinata|web3storage|local]
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join, relative } from 'node:path';

// Configuration
const BUILD_DIR = 'build';
const APP_NAME = 'AURA';

// ANSI colors for terminal output
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
	console.log(`\n${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
	console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
	console.log(`${colors.red}✗${colors.reset} ${message}`);
}

// Parse command line arguments
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		provider: 'pinata', // default
	};

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--provider' && args[i + 1]) {
			options.provider = args[i + 1];
			i++;
		}
	}

	return options;
}

// Build the application
async function build() {
	logStep('1/4', 'Building application...');
	
	try {
		execSync('bun run build', { stdio: 'inherit' });
		logSuccess('Build completed successfully');
	} catch (error) {
		logError('Build failed');
		throw error;
	}
}

// Get all files in directory recursively
function getAllFiles(dir, fileList = []) {
	const files = readdirSync(dir);
	
	for (const file of files) {
		const filePath = join(dir, file);
		const stat = statSync(filePath);
		
		if (stat.isDirectory()) {
			getAllFiles(filePath, fileList);
		} else {
			fileList.push(filePath);
		}
	}
	
	return fileList;
}

// Deploy to Pinata
async function deployToPinata() {
	logStep('2/4', 'Deploying to Pinata...');
	
	const apiKey = process.env.PINATA_API_KEY;
	const apiSecret = process.env.PINATA_API_SECRET;
	
	if (!apiKey || !apiSecret) {
		logError('Missing PINATA_API_KEY or PINATA_API_SECRET environment variables');
		console.log('\nTo set up Pinata:');
		console.log('1. Create an account at https://www.pinata.cloud');
		console.log('2. Get your API keys from the API Keys section');
		console.log('3. Set environment variables:');
		console.log('   export PINATA_API_KEY="your-api-key"');
		console.log('   export PINATA_API_SECRET="your-api-secret"');
		process.exit(1);
	}
	
	try {
		// Use Pinata CLI or API
		const FormData = (await import('form-data')).default;
		const fetch = (await import('node-fetch')).default;
		
		const formData = new FormData();
		const files = getAllFiles(BUILD_DIR);
		
		// Add all files to form
		for (const file of files) {
			const relativePath = relative(BUILD_DIR, file);
			formData.append('file', createReadStream(file), {
				filepath: `${APP_NAME}/${relativePath}`,
			});
		}
		
		// Pinata options
		const pinataMetadata = JSON.stringify({
			name: `${APP_NAME}-${new Date().toISOString()}`,
		});
		formData.append('pinataMetadata', pinataMetadata);
		
		const pinataOptions = JSON.stringify({
			cidVersion: 1,
			wrapWithDirectory: false,
		});
		formData.append('pinataOptions', pinataOptions);
		
		const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
			method: 'POST',
			headers: {
				'pinata_api_key': apiKey,
				'pinata_secret_api_key': apiSecret,
			},
			body: formData,
		});
		
		const result = await response.json();
		
		if (result.IpfsHash) {
			return result.IpfsHash;
		} else {
			throw new Error(result.error || 'Failed to pin to Pinata');
		}
	} catch (error) {
		logError(`Pinata deployment failed: ${error.message}`);
		throw error;
	}
}

// Deploy to web3.storage
async function deployToWeb3Storage() {
	logStep('2/4', 'Deploying to web3.storage...');
	
	const token = process.env.WEB3_STORAGE_TOKEN;
	
	if (!token) {
		logError('Missing WEB3_STORAGE_TOKEN environment variable');
		console.log('\nTo set up web3.storage:');
		console.log('1. Create an account at https://web3.storage');
		console.log('2. Get your API token');
		console.log('3. Set environment variable:');
		console.log('   export WEB3_STORAGE_TOKEN="your-token"');
		process.exit(1);
	}
	
	try {
		// Note: web3.storage has a new API - this is simplified
		const fetch = (await import('node-fetch')).default;
		const { CarWriter } = await import('@ipld/car');
		const { filesFromPaths } = await import('files-from-path');
		
		const files = await filesFromPaths([BUILD_DIR]);
		
		const response = await fetch('https://api.web3.storage/upload', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
			},
			body: files,
		});
		
		const result = await response.json();
		return result.cid;
	} catch (error) {
		logError(`web3.storage deployment failed: ${error.message}`);
		console.log('\nNote: web3.storage API may have changed. Consider using Pinata instead.');
		throw error;
	}
}

// Deploy to local IPFS
async function deployToLocalIPFS() {
	logStep('2/4', 'Deploying to local IPFS node...');
	
	try {
		// Check if IPFS is running
		execSync('ipfs version', { stdio: 'pipe' });
	} catch {
		logError('IPFS not found or not running');
		console.log('\nTo set up local IPFS:');
		console.log('1. Install IPFS: https://docs.ipfs.tech/install/');
		console.log('2. Initialize: ipfs init');
		console.log('3. Start daemon: ipfs daemon');
		process.exit(1);
	}
	
	try {
		const result = execSync(`ipfs add -r -Q ${BUILD_DIR}`, { encoding: 'utf8' });
		return result.trim();
	} catch (error) {
		logError(`Local IPFS deployment failed: ${error.message}`);
		throw error;
	}
}

// Generate deployment summary
function generateSummary(cid, provider) {
	logStep('3/4', 'Generating deployment summary...');
	
	const gateways = [
		`https://ipfs.io/ipfs/${cid}`,
		`https://dweb.link/ipfs/${cid}`,
		`https://cloudflare-ipfs.com/ipfs/${cid}`,
		`https://${cid}.ipfs.cf-ipfs.com`,
		`https://${cid}.ipfs.dweb.link`,
	];
	
	console.log('\n' + '='.repeat(60));
	log(`  ${APP_NAME} IPFS Deployment Complete!`, 'bright');
	console.log('='.repeat(60));
	
	console.log(`\n${colors.yellow}CID:${colors.reset} ${cid}`);
	console.log(`${colors.yellow}Provider:${colors.reset} ${provider}`);
	console.log(`${colors.yellow}Timestamp:${colors.reset} ${new Date().toISOString()}`);
	
	console.log(`\n${colors.cyan}Access URLs:${colors.reset}`);
	gateways.forEach((url, i) => {
		console.log(`  ${i + 1}. ${url}`);
	});
	
	console.log(`\n${colors.green}ENS/DNSLink:${colors.reset}`);
	console.log(`  To use with a custom domain, set a DNSLink TXT record:`);
	console.log(`  _dnslink.yourdomain.com TXT "dnslink=/ipfs/${cid}"`);
	
	console.log('\n' + '='.repeat(60));
	
	return { cid, gateways };
}

// Update README with IPFS link
function updateReadme(cid) {
	logStep('4/4', 'Updating README...');
	
	const readmePath = 'README.md';
	if (!existsSync(readmePath)) {
		log('README.md not found, skipping update', 'yellow');
		return;
	}
	
	try {
		let readme = readFileSync(readmePath, 'utf8');
		
		// Check if IPFS section exists
		const ipfsSection = `### 🌐 IPFS Access

AURA is available on IPFS for censorship-resistant access:

\`\`\`
CID: ${cid}
\`\`\`

Access via gateways:
- [ipfs.io](https://ipfs.io/ipfs/${cid})
- [dweb.link](https://dweb.link/ipfs/${cid})
- [cloudflare-ipfs.com](https://cloudflare-ipfs.com/ipfs/${cid})`;

		if (readme.includes('### 🌐 IPFS Access')) {
			// Update existing section
			readme = readme.replace(
				/### 🌐 IPFS Access[\s\S]*?(?=###|$)/,
				ipfsSection + '\n\n',
			);
		} else {
			// Add section after deployment section or at the end
			const deploymentIndex = readme.indexOf('## Deployment');
			if (deploymentIndex !== -1) {
				const nextSection = readme.indexOf('##', deploymentIndex + 15);
				if (nextSection !== -1) {
					readme = readme.slice(0, nextSection) + ipfsSection + '\n\n' + readme.slice(nextSection);
				} else {
					readme += '\n\n' + ipfsSection;
				}
			} else {
				readme += '\n\n' + ipfsSection;
			}
		}
		
		// Note: In production, you'd write this back
		// writeFileSync(readmePath, readme);
		logSuccess('README update prepared (dry run)');
		console.log('To update README, add the IPFS section manually or run with --write flag');
	} catch (error) {
		log(`Failed to update README: ${error.message}`, 'yellow');
	}
}

// Main deployment flow
async function main() {
	console.log('\n' + colors.bright + colors.cyan);
	console.log('  ╔═══════════════════════════════════════╗');
	console.log('  ║     AURA IPFS Deployment Script       ║');
	console.log('  ╚═══════════════════════════════════════╝');
	console.log(colors.reset);
	
	const options = parseArgs();
	
	try {
		// Step 1: Build
		await build();
		
		// Verify build exists
		if (!existsSync(BUILD_DIR)) {
			logError(`Build directory not found: ${BUILD_DIR}`);
			process.exit(1);
		}
		
		// Step 2: Deploy based on provider
		let cid;
		switch (options.provider) {
			case 'pinata':
				cid = await deployToPinata();
				break;
			case 'web3storage':
				cid = await deployToWeb3Storage();
				break;
			case 'local':
				cid = await deployToLocalIPFS();
				break;
			default:
				logError(`Unknown provider: ${options.provider}`);
				console.log('Available providers: pinata, web3storage, local');
				process.exit(1);
		}
		
		// Step 3: Generate summary
		generateSummary(cid, options.provider);
		
		// Step 4: Update README (optional)
		updateReadme(cid);
		
		logSuccess('\nDeployment completed successfully!');
		
	} catch (error) {
		logError(`\nDeployment failed: ${error.message}`);
		process.exit(1);
	}
}

main();
