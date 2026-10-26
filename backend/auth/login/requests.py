from pydantic import BaseModel

from auth.passkey import AuthenticatorAssertionResponse, PasskeyAssertion


class PasskeyLoginRequest(BaseModel):
    assertion: PasskeyAssertion | None = None

    def to_authentication_response(self) -> AuthenticatorAssertionResponse:
        return AuthenticatorAssertionResponse(response=self.assertion)
