import logging

from authtuna.core.encryption import encryption_utils
from authtuna.helpers import create_session_and_set_cookie
from authtuna.integrations import auth_service
from fastapi import APIRouter, HTTPException, Request, Response

from auth.login.requests import PasskeyLoginRequest
from auth.passkey import PASSKEY_AUTH_CHALLENGE_SESSION_KEY, verify_authentication

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/passkey")
async def login_with_passkey(
    payload: PasskeyLoginRequest,
    request: Request,
    response: Response,
) -> dict[str, object]:
    if payload.assertion is None:
        logger.info("Starting passkey login")
        options, challenge = (
            auth_service.passkeys.core.generate_authentication_options()
        )
        request.session[PASSKEY_AUTH_CHALLENGE_SESSION_KEY] = challenge
        return {"options": options}

    challenge = request.session.pop(PASSKEY_AUTH_CHALLENGE_SESSION_KEY, None)
    if challenge is None:
        logger.warning("Passkey login rejected: challenge missing or expired")
        raise HTTPException(400, "Passkey login expired. Start again.")

    try:
        credential_id = encryption_utils.base64url_decode(str(payload.assertion["id"]))
    except (KeyError, ValueError) as error:
        logger.warning("Passkey login rejected: malformed credential identifier")
        raise HTTPException(400, "Invalid passkey response.") from error

    credential = await auth_service.passkeys.get_credential_by_id(credential_id)
    if credential is None:
        logger.info("Passkey login rejected: credential not found")
        raise HTTPException(404, "This passkey is not registered.")

    try:
        sign_count = verify_authentication(
            response=payload.to_authentication_response(),
            session_challenge=challenge,
            credential=credential,
        )
    except ValueError:
        logger.warning("Passkey authentication verification failed")
        raise HTTPException(400, "Passkey authentication failed.") from None

    await auth_service.passkeys.update_credential_on_login(credential_id, sign_count)
    user = await auth_service.users.get_by_id(credential.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Passkey user is inactive or missing.")
    await create_session_and_set_cookie(
        user, request, response, auth_service.db_manager.get_db()
    )
    logger.info("Passkey login succeeded")
    return {"status": "logged_in"}
