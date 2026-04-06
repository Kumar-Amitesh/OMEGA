"""
models/job_description.py

Stores a user-uploaded Job Description (JD) for interview prep.
One JD per Chat (older ones are replaced on re-upload).
"""

from datetime import datetime
from extensions import db


class JobDescription(db.Model):
    __tablename__ = "job_description"

    id          = db.Column(db.String(50),  primary_key=True)
    chat_id     = db.Column(db.String(50),  db.ForeignKey("chat.id"), nullable=False, index=True)

    # Raw text from paste or file extraction
    raw_text    = db.Column(db.Text)

    # LLM-parsed structure stored as JSON string:
    # { title, company, skills[], experience, responsibilities[],
    #   requirements[], keywords[], domain }
    parsed_json = db.Column(db.Text)

    # Always "jd" – distinguishes from exam PDFs
    doc_type    = db.Column(db.String(20),  default="jd")

    is_processed = db.Column(db.Boolean,   default=False)
    error        = db.Column(db.Text)

    uploaded_at  = db.Column(db.DateTime,  default=datetime.utcnow)
