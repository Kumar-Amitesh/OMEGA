from flask import Blueprint, jsonify
from services.auth_service import get_user_from_token
from services.chroma_service import get_chroma_client, chroma_collection_name, get_chroma_collection

bp = Blueprint("debug_routes", __name__)


@bp.route('/', methods=['GET'])
def home():
    return jsonify({"message": "Exam Prep AI Backend Running"}), 200


@bp.route("/debug/chroma/<chat_id>")
def debug_chroma(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    client = get_chroma_client()
    name = chroma_collection_name(user.id, chat_id)

    col = get_chroma_collection(client, name)

    return {
        "collection": name,
        "count": col.count()
    }