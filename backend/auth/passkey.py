import logging
from typing import Any, NotRequired, TypedDict

from authtuna.core.database import PasskeyCredential
from authtuna.integrations import auth_service

logger = logging.getLogger(__name__)


class PasskeyAssertion(TypedDict):
    id: str
    response: AssertionAuthenticatorResult


class AssertionAuthenticatorResult(TypedDict):
    authenticatorData: str
    clientDataJSON: str
    signature: str


class PasskeyAttestation(TypedDict):
    response: AttestationAuthenticatorResult


class AttestationAuthenticatorResult(TypedDict):
    attestationObject: str
    clientDataJSON: str
    transports: NotRequired[list[str]]


# don't change anything below, unless you want to break the auth flow
PASSKEY_AUTH_CHALLENGE_SESSION_KEY = "passkey_authentication_challenge"
PASSKEY_REGISTER_CHALLENGE_SESSION_KEY = "passkey_registration_challenge"
PASSKEY_FLOW_USER_ID_SESSION_KEY = "passkey_flow_user_id"


class AuthenticatorAttestationResponse(TypedDict):
    response: PasskeyAttestation


class AuthenticatorAssertionResponse(TypedDict):
    response: PasskeyAssertion | None


class SessionChallenge(TypedDict):
    challenge: str  # base64 encoded challenge
    timestamp: int | float


# wrapper function to add proper type annotations
def verify_registration(
    response: AuthenticatorAttestationResponse, session_challenge: SessionChallenge
) -> dict[str, Any]:
    return auth_service.passkeys.core.verify_registration(
        response["response"], session_challenge
    )


def verify_authentication(
    response: AuthenticatorAssertionResponse,
    session_challenge: SessionChallenge,
    credential: PasskeyCredential,
) -> dict[str, Any]:
    return auth_service.passkeys.core.verify_authentication(
        response["response"], session_challenge, credential
    )
