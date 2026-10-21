import hashlib
import hmac
import secrets

def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600000).hex()
    return f"pbkdf2_sha256$600000${salt}${digest}"

def verify_password(password, encoded):
    _, iterations, salt, expected = encoded.split("$")
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
    return hmac.compare_digest(actual, expected)

def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()
