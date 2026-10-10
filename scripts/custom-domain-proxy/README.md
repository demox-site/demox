# Custom domain proxy

`customers.demox.site` is the CNAME target shown in the console. EdgeOne only accepts `*.demox.site`, so third-party hosts cannot be added to that zone. This proxy on **aigc** terminates TLS and forwards to `{websiteId}.demox.site`.

Install on aigc:

```bash
sudo mkdir -p /opt/demox-customer-proxy /var/www/demox-acme
sudo cp scripts/custom-domain-proxy/sync.sh /opt/demox-customer-proxy/sync.sh
sudo chmod +x /opt/demox-customer-proxy/sync.sh
# MYSQL_* in /opt/demox-customer-proxy/.env (same DB as website-api)
echo 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
*/2 * * * * root /opt/demox-customer-proxy/sync.sh >> /var/log/demox-customer-proxy.log 2>&1' \
  | sudo tee /etc/cron.d/demox-customer-proxy
```

Point `customers.demox.site` at aigc (`119.91.123.2`). Users CNAME their host to `customers.demox.site`.

The proxy must resolve `{websiteId}.demox.site` over IPv4 only. aigc has no public IPv6 route; EdgeOne publishes AAAA records, and `proxy_pass https://origin` would try those first.

## Certificate issuance backoff

`sync.sh` only issues **first** certificates (renewals are `certbot-renew.timer`'s job and are never skipped).
When a first issuance fails, it writes `/var/lib/demox-customer-proxy/acme-fail/<host>` (`<count> <epoch>`) and skips
that host for 1h, 6h, 24h, 48h, 96h, then 7 days per further failure, logging
`skip cert for <host>: backoff after N failed attempt(s), next try after …`. A user-triggered `sync.sh --host <host>`
(via provision.py) may retry 15 min after the last failure. Success, or a live cert appearing, clears the file.
To retry a host immediately: `rm /var/lib/demox-customer-proxy/acme-fail/<host>`.
Live certs with < 25 days left log `WARNING: cert for <host> expires …` on every run (renewal is failing).
Tests: `bash scripts/custom-domain-proxy/sync-backoff.test.sh`.
