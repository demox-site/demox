-- Funx console: confidential OAuth client, identity scope only.
-- client_secret holds ONLY a hash: "sha256$" + hex(SHA-256(secret)). The plaintext secret is a 256-bit random
-- value kept outside git (funx-api env FUNX_DEMOX_CLIENT_SECRET). Rotate by replacing this hash.
-- Exactly one redirect URI, exact match (no wildcard).
-- Rollback / disconnect: DELETE FROM oauth_clients WHERE id = 'funx-console';
INSERT INTO oauth_clients (id, client_secret, redirect_uris, scopes, client_name)
VALUES (
  'funx-console',
  'sha256$160147f2a030fcf389870bc8ea0bb4ce55042e94422c58b57ce2b745562d8e13',
  '["https://funx.site/console/auth/demox/callback"]',
  '["identity"]',
  'Funx'
)
ON DUPLICATE KEY UPDATE
  client_secret = VALUES(client_secret),
  redirect_uris = VALUES(redirect_uris),
  scopes = VALUES(scopes),
  client_name = VALUES(client_name);
