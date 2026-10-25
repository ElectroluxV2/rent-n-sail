from pydantic import BaseModel

from auth.passkey import PasskeyAssertion


class PasskeyLoginRequest(BaseModel):
    response: PasskeyAssertion | None = None
