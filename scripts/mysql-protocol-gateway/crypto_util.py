"""AES-256-GCM decrypt matching scf-code/website-api/shared/crypto.js."""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

SALT_LEN = 16
IV_LEN = 12
TAG_LEN = 16
KEY_LEN = 32


def _master_key() -> bytes:
    key = os.environ.get("ENCRYPTION_KEY") or ""
    if len(key) < 16:
        raise RuntimeError("ENCRYPTION_KEY missing or too short")
    return key.encode("utf-8")


def decrypt(enc: str | None) -> str | None:
    if enc is None or enc == "":
        return None
    raw = base64.b64decode(enc)
    salt = raw[:SALT_LEN]
    iv = raw[SALT_LEN : SALT_LEN + IV_LEN]
    tag = raw[SALT_LEN + IV_LEN : SALT_LEN + IV_LEN + TAG_LEN]
    ct = raw[SALT_LEN + IV_LEN + TAG_LEN :]
    kdf = Scrypt(salt=salt, length=KEY_LEN, n=16384, r=8, p=1)
    key = kdf.derive(_master_key())
    # Node GCM authTag is separate; cryptography AESGCM expects ct||tag
    aesgcm = AESGCM(key)
    plain = aesgcm.decrypt(iv, ct + tag, None)
    return plain.decode("utf-8")


def timing_safe_equal(left: str, right: str) -> bool:
    a = hashlib.sha256(left.encode("utf-8")).digest()
    b = hashlib.sha256(right.encode("utf-8")).digest()
    return a == b
