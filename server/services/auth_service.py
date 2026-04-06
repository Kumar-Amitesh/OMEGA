from flask import request
from models import User
from utils.auth import verify_token


def get_user_from_token():
    token = request.headers.get('Authorization')
    if token and token.startswith('Bearer '):
        token = token[7:]
        user_id = verify_token(token)
        if user_id:
            return User.query.get(user_id)
    return None