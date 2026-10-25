from typing import NotRequired, TypedDict


class AssertionAuthenticatorResult(TypedDict):
    authenticatorData: str
    clientDataJSON: str
    signature: str


class PasskeyAssertion(TypedDict):
    id: str
    response: AssertionAuthenticatorResult


class AttestationAuthenticatorResult(TypedDict):
    attestationObject: str
    clientDataJSON: str
    transports: NotRequired[list[str]]


class PasskeyAttestation(TypedDict):
    response: AttestationAuthenticatorResult
