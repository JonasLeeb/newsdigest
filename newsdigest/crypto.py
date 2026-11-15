"""Passphrase encryption shared with the browser (static/radar.js).

Format (JSON): {"v":1,"kdf":"PBKDF2-SHA256","iter":N,"salt":b64,"iv":b64,"ct":b64}
AES-256-GCM, key = PBKDF2-HMAC-SHA256(passphrase, salt, iter). WebCrypto-compatible.
"""
from __future__ import annotations

import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 250_000


def _key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt(obj, passphrase: str) -> str:
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(passphrase, salt, ITER)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    b = lambda x: base64.b64encode(x).decode()  # noqa: E731
    return json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)})


def decrypt(text: str, passphrase: str):
    d = json.loads(text)
    u = base64.b64decode
    pt = AESGCM(_key(passphrase, u(d["salt"]), d["iter"])).decrypt(u(d["iv"]), u(d["ct"]), None)
    return json.loads(pt.decode("utf-8"))
