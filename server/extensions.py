from flask_sqlalchemy import SQLAlchemy
from celery import Celery

db = SQLAlchemy()

celery = Celery(
    "worker",
    broker="redis://redis:6379/0"
)