from typing import NotRequired, TypedDict

from pydantic import BaseModel, Field

from auth.passkey import PasskeyAttestation


class PasskeyRegistrationInitRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)


class PasskeyRegistrationCompleteRequest(BaseModel):
    response: PasskeyAttestation


class RegistrationClientExtensionResults(TypedDict):
    credProps: NotRequired[dict[str, bool]]
