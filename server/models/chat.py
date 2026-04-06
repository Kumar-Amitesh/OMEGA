from datetime import datetime
import json
from extensions import db


class Chat(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('user.id'))

    exam_type = db.Column(db.String(50))
    exam_config = db.Column(db.Text)
    bloom_level = db.Column(db.Text)

    weak_topics_json = db.Column(db.Text)
    # preparedness_score = db.Column(db.Float)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    pdfs = db.relationship('PDFDocument', backref='chat', lazy=True, cascade='all, delete-orphan')
    sessions = db.relationship('PracticeSession', backref='chat', lazy=True, cascade='all, delete-orphan')

    def get_weak_topics_summary(self):
        if not self.weak_topics_json:
            return []
        return json.loads(self.weak_topics_json)