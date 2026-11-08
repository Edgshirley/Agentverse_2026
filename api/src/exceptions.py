"""
API exceptions (mirrors ../freevo-api/app/src/exceptions.py).
"""

from fastapi import HTTPException


class APIException(HTTPException):
    """Base class: every subclass maps to one HTTP status."""

    status_code: int = 500

    def __init__(self, detail: str = None):
        super().__init__(status_code=self.status_code, detail=detail)


class BadRequestError(APIException):
    status_code = 400


class AuthenticationError(APIException):
    status_code = 401


class ConflictError(APIException):
    status_code = 409


class StatusLockedError(APIException):
    status_code = 423


class BadGatewayError(APIException):
    status_code = 502
