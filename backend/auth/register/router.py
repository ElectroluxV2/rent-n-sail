import logging
import secrets

from authtuna.helpers import create_session_and_set_cookie
from authtuna.integrations import auth_service
from fastapi import APIRouter, HTTPException, Request, Response

from auth.register.requests import (
    PasskeyRegistrationCompleteRequest,
    PasskeyRegistrationInitRequest,
)

router = APIRouter(prefix="/passkey")
logger = logging.getLogger(__name__)


@router.post("/init")
async def register_init(
    payload: PasskeyRegistrationInitRequest,
    request: Request,
) -> dict[str, object]:
    username = payload.username.strip()
    if not username:
        raise HTTPException(422, "A username is required to register.")

    user_id = request.session.get("passkey_flow_user_id")
    if user_id is None:
        logger.info("Creating account for passkey registration")
        email = f"{secrets.token_urlsafe(24)}@passkey.rent-n-sail.invalid"
        password = secrets.token_urlsafe(48)
        user, _ = await auth_service.signup(
            username=username,
            email=email,
            password=password,
            ip_address=request.state.user_ip_address,
        )
        user_id = user.id
        request.session["passkey_flow_user_id"] = user_id

    user = await auth_service.users.get_by_id(user_id)
    if user is None:
        request.session.pop("passkey_flow_user_id", None)
        logger.warning(
            "Passkey registration initialization failed: pending user missing"
        )
        raise HTTPException(404, "Registration expired. Try again.")

    options, challenge = auth_service.passkeys.core.generate_registration_options(
        user_id=user.id,
        username=user.username,
        existing_credentials=await auth_service.passkeys.get_for_user(user.id),
    )
    request.session["passkey_registration_challenge"] = challenge
    logger.info("Passkey registration options generated")
    return {"options": options}


@router.post("/complete")
async def register_complete(
    payload: PasskeyRegistrationCompleteRequest,
    request: Request,
    response: Response,
) -> dict[str, str]:
    challenge = request.session.pop("passkey_registration_challenge", None)
    user_id = request.session.get("passkey_flow_user_id")
    if challenge is None or user_id is None:
        logger.warning(
            "Passkey registration rejected: challenge or pending user missing"
        )
        raise HTTPException(400, "Passkey registration expired. Start again.")

    try:
        credential_data = auth_service.passkeys.core.verify_registration(
            response=payload.response,
            session_challenge=challenge,
        )
        await auth_service.passkeys.save_new_credential(
            user_id=user_id,
            cred_data=credential_data,
            nickname="Passkey",
        )
        user = await auth_service.users.get_by_id(user_id)
        if user is None:
            raise HTTPException(404, "New user was not found.")
        await create_session_and_set_cookie(
            user, request, response, auth_service.db_manager.get_db()
        )
        request.session.pop("passkey_flow_user_id", None)
    except ValueError as error:
        logger.exception("Passkey registration verification failed", exc_info=error)
        raise HTTPException(400, "Passkey registration failed.") from None

    logger.info("Passkey registration succeeded")
    return {"status": "registered"}
