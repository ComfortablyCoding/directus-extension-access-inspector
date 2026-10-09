import { expect, test } from 'vitest';
import { ipInNetworks, isValidIp } from './ip.js';

test.each([
	['192.168.1.20', ['192.168.1.20'], true],
	['192.168.1.20', ['192.168.1.0/24'], true],
	['192.168.2.20', ['192.168.1.0/24'], false],
	['10.0.0.5', ['10.0.0.1-10.0.0.9'], true],
	['10.0.0.10', ['10.0.0.1-10.0.0.9'], false],
	['10.0.0.10', ['172.16.0.0/12', ' 10.0.0.0/8 '], true],
	['0.0.0.1', ['0.0.0.0/0'], true],
	['::ffff:192.168.1.20', ['192.168.1.0/24'], true],
	['192.168.1.20', ['::ffff:192.168.1.0/120'], true],
	['2001:db8::1', ['2001:db8::/32'], true],
	['2001:db9::1', ['2001:db8::/32'], false],
	['::1', ['::1'], true],
	['fe80::1%eth0', ['fe80::/10'], true],
	['192.168.1.20', ['2001:db8::/32'], false],
	['192.168.1.20', ['not-an-ip', '192.168.1.0/33'], false],
])('%s in %j is %s', (ip, networks, expected) => {
	expect(ipInNetworks(ip, networks)).toBe(expected);
});

test.each(['1.2.3.4', '::', '2001:db8::8a2e:370:7334', '::ffff:1.2.3.4'])('accepts %s', (ip) => {
	expect(isValidIp(ip)).toBe(true);
});

test.each(['', '1.2.3', '256.1.1.1', '1:2:3:4:5:6:7:8:9', '1::2::3', 'g::1'])('rejects %j', (ip) => {
	expect(isValidIp(ip)).toBe(false);
});
