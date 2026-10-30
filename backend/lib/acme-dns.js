import { CloudflareDnsClient } from './cloudflare-dns.js';
import { FreeDnsClient } from './freedns-dns.js';

export function createAcmeDnsClient(config, { fetchFn = globalThis.fetch, onSession } = {}) {
  if (config.dnsProvider === 'freedns') {
    return new FreeDnsClient({
      username: config.freednsUsername,
      password: config.freednsPassword,
      sessionCookie: config.freednsSessionCookie,
      fetchFn,
      onSession,
    });
  }
  return new CloudflareDnsClient({ zoneId: config.zoneId, apiToken: config.apiToken, fetchFn });
}
