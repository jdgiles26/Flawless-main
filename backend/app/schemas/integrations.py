"""Data models for collaboration notification endpoints."""

from pydantic import BaseModel


class CollaborationNotificationRequest(BaseModel):
    channel: str
    message: str = "Flawless channel connectivity test: the configuration is valid and can receive alert, diagnostic, and approval notifications."

