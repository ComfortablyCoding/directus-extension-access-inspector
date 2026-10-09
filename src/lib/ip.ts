// Mirrors Directus' policy IP access check (`ipInNetworks` in @directus/utils), which runs on Node's BlockList and so
// isn't available in the browser. Networks are addresses, CIDR subnets or `start-end` ranges.

interface Address {
	version: 4 | 6;
	value: bigint;
}

export function ipInNetworks(ip: string, networks: string[]): boolean {
	const address = parseAddress(ip);
	if (!address) return false;

	return networks.some((network) => {
		const range = parseNetwork(network.trim());
		return (
			range !== null && range.version === address.version && address.value >= range.start && address.value <= range.end
		);
	});
}

export function isValidIp(ip: string): boolean {
	return parseAddress(ip) !== null;
}

function parseNetwork(network: string): { version: 4 | 6; start: bigint; end: bigint } | null {
	if (network.includes('-')) {
		const [from = '', to = ''] = network.split('-');
		const start = parseAddress(from.trim());
		const end = parseAddress(to.trim());
		if (!start || !end || start.version !== end.version) return null;
		return { version: start.version, start: start.value, end: end.value };
	}

	if (network.includes('/')) {
		const [ip = '', prefix = ''] = network.split('/');
		const base = parseAddress(ip);
		if (!base || !/^\d+$/.test(prefix)) return null;

		// An IPv4-mapped IPv6 subnet such as ::ffff:10.0.0.0/104 is matched as IPv4, like Node does.
		const mapped = base.version === 4 && ip.includes(':');
		const bits = base.version === 4 ? 32 : 128;
		const length = Number(prefix) - (mapped ? 96 : 0);
		if (length < 0 || length > bits) return null;

		const hostMask = (1n << BigInt(bits - length)) - 1n;
		const start = base.value & ~hostMask;
		return { version: base.version, start, end: start | hostMask };
	}

	const address = parseAddress(network);
	return address && { version: address.version, start: address.value, end: address.value };
}

function parseAddress(input: string): Address | null {
	const ip = input.trim();
	if (ip.includes(':')) return parseIpv6(ip);

	const value = parseIpv4(ip);
	return value === null ? null : { version: 4, value };
}

function parseIpv4(ip: string): bigint | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;

	let value = 0n;

	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
		value = (value << 8n) | BigInt(part);
	}

	return value;
}

const groups = (half: string) => (half === '' ? [] : half.split(':'));

function parseIpv6(input: string): Address | null {
	// Zone IDs such as fe80::1%eth0 don't affect matching.
	let ip = input.split('%')[0]!;
	let tail: bigint | null = null;

	// An embedded IPv4 address, as in ::ffff:192.0.2.1, takes the last two groups.
	const lastColon = ip.lastIndexOf(':');
	if (ip.slice(lastColon + 1).includes('.')) {
		tail = parseIpv4(ip.slice(lastColon + 1));
		if (tail === null) return null;
		ip = `${ip.slice(0, lastColon + 1)}0:0`;
	}

	const halves = ip.split('::');
	if (halves.length > 2) return null;

	const head = groups(halves[0]!);
	const rest = halves.length === 2 ? groups(halves[1]!) : [];
	const missing = 8 - head.length - rest.length;

	if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

	let value = 0n;

	for (const group of [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]) {
		if (!/^[\da-f]{1,4}$/i.test(group)) return null;
		value = (value << 16n) | BigInt(`0x${group}`);
	}

	if (tail !== null) value = (value & ~0xffffffffn) | tail;

	// IPv4-mapped addresses (::ffff:a.b.c.d) are matched against IPv4 networks.
	if (value >> 32n === 0xffffn) return { version: 4, value: value & 0xffffffffn };

	return { version: 6, value };
}
