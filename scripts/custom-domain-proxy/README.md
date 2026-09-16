# Custom domain proxy

`customers.demox.site` is the CNAME target shown in the console. EdgeOne only accepts `*.demox.site`, so third-party hosts cannot be added to that zone. This proxy on **aigc** terminates TLS and forwards to `{websiteId}.demox.site`.

Install on aigc:

```bash
sudo mkdir -p /opt/demox-customer-proxy /var/www/demox-acme
sudo cp scripts/custom-domain-proxy/sync.sh /opt/demox-customer-proxy/sync.sh
sudo chmod +x /opt/demox-customer-proxy/sync.sh
# MYSQL_* in /opt/demox-customer-proxy/.env (same DB as website-api)
echo '*/2 * * * * root /opt/demox-customer-proxy/sync.sh >> /var/log/demox-customer-proxy.log 2>&1' \
  | sudo tee /etc/cron.d/demox-customer-proxy
```

Point `customers.demox.site` at aigc (`119.91.123.2`). Users CNAME their host to `customers.demox.site`.
