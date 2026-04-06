"""
models/misconception.py

Stores wrong-answer option data per topic per chat for misconception fingerprinting.
New model — does not touch any existing model or column.

Each row = one wrong MCQ answer event.
Aggregated by misconception_service.py to find patterns.
"""

from datetime import datetime
from extensions import db


class MisconceptionRecord(db.Model):
    __tablename__ = "misconception_record"

    id              = db.Column(db.Integer, primary_key=True, autoincrement=True)
    chat_id         = db.Column(db.String(50), db.ForeignKey("chat.id"), nullable=False, index=True)
    session_id      = db.Column(db.String(50), db.ForeignKey("practice_session.id"), nullable=False)

    topic           = db.Column(db.String(200), nullable=False, index=True)
    bloom_level     = db.Column(db.String(50))
    difficulty      = db.Column(db.String(20))

    question_text   = db.Column(db.Text)                 # full question string
    correct_option  = db.Column(db.String(10))           # "A", "B", "C", "D"
    chosen_option   = db.Column(db.String(10))           # what student picked
    correct_text    = db.Column(db.Text)                 # text of correct option
    chosen_text     = db.Column(db.Text)                 # text of wrong option chosen
    question_type   = db.Column(db.String(20), default="mcq")  # mcq | true_false | fill_blank

    created_at      = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":            self.id,
            "topic":         self.topic,
            "bloomLevel":    self.bloom_level,
            "difficulty":    self.difficulty,
            "question":      self.question_text,
            "questionType":  self.question_type,
            "correctOption": self.correct_option,
            "chosenOption":  self.chosen_option,
            "correctText":   self.correct_text,
            "chosenText":    self.chosen_text,
            "createdAt":     self.created_at.isoformat(),
        }