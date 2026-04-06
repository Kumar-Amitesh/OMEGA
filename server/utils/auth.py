import os
from datetime import datetime, timedelta
from jose import jwt
from jose.exceptions import JWTError
from werkzeug.security import generate_password_hash, check_password_hash

SECRET_KEY = os.getenv("JWT_SECRET", "exam-secret")


def hash_password(p):
    return generate_password_hash(p)


def verify_password(h, p):
    return check_password_hash(h, p)


def generate_token(uid):
    payload = {
        "user_id": uid,
        "exp": datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def verify_token(token):
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return data.get("user_id")
    except JWTError:
        return None