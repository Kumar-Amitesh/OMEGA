from datetime import datetime
from extensions import db


class SubjectTopic(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.String(50), db.ForeignKey('chat.id'))

    topic_name = db.Column(db.String(200))
    unit_name = db.Column(db.String(200))


class PracticeSession(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    chat_id = db.Column(db.String(50), db.ForeignKey('chat.id'))

    session_type = db.Column(db.String(50))
    questions = db.Column(db.Text)
    answers = db.Column(db.Text)

    score = db.Column(db.Float)
    weak_topics_json = db.Column(db.Text)
    feedback_json = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class GeneratedQuestion(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    chat_id = db.Column(db.String(50))

    question_hash = db.Column(db.String(64))
    topic = db.Column(db.String(200))

    times_asked = db.Column(db.Integer, default=1)
    avg_score = db.Column(db.Float, default=0.0)