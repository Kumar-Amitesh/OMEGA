from flask import Blueprint, request, jsonify
from models import User
from extensions import db
from utils import generate_id, hash_password, verify_password, generate_token
from services.auth_service import get_user_from_token

bp = Blueprint("auth_routes", __name__)


@bp.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json

    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'User already exists'}), 400

    user = User(
        id=generate_id(),
        email=data['email'],
        name=data['name'],
        password_hash=hash_password(data['password'])
    )

    db.session.add(user)
    db.session.commit()

    token = generate_token(user.id)

    return jsonify({
        'token': token,
        'user': {
            'id': user.id,
            'email': user.email,
            'name': user.name
        }
    }), 201


@bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json

    user = User.query.filter_by(email=data['email']).first()

    if not user or not verify_password(user.password_hash, data['password']):
        return jsonify({'error': 'Invalid credentials'}), 401

    token = generate_token(user.id)

    return jsonify({
        'token': token,
        'user': {
            'id': user.id,
            'email': user.email,
            'name': user.name
        }
    })

@bp.route('/api/auth/me', methods=['GET'])
def get_me():
    """
    Fetch the authenticated user from the DB using their JWT token.
    Frontend should call this on app init instead of trusting localStorage.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
 
    return jsonify({
        'id': user.id,
        'email': user.email,
        'name': user.name
    })