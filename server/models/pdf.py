from datetime import datetime
from extensions import db


class PDFDocument(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    chat_id = db.Column(db.String(50), db.ForeignKey('chat.id'))

    filename = db.Column(db.String(200))
    file_path = db.Column(db.String(300))

    file_hash = db.Column(db.String(64), index=True)

    pdf_type = db.Column(db.String(50))
    is_processed = db.Column(db.Boolean, default=False)
    error = db.Column(db.Text)

    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("chat_id", "file_hash", name="uix_chat_filehash"),
    )