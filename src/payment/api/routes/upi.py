# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""UPI wallet endpoints: ReservePay mandates and P3P payment (feature 20)."""

from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pinelabs_p3p_server import P3PError as ServerP3PError
from sqlmodel import Session

from src.payment.api.dependencies import verify_psp_api_key
from src.payment.api.schemas import (
    CreateUpiMandateRequest,
    Mobile,
    UpiMandateResponse,
    UpiPayRequest,
)
from src.payment.config import get_payment_settings
from src.payment.db.database import get_session
from src.payment.db.models import UpiMandate
from src.payment.services import pinelabs

router = APIRouter(
    prefix="/upi", tags=["upi"], dependencies=[Depends(verify_psp_api_key)]
)

DB = Annotated[Session, Depends(get_session)]


@contextmanager
def _pinelabs_errors() -> Generator[None, None, None]:
    try:
        yield
    except pinelabs.PineLabsNotConfiguredError as e:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "pinelabs_not_configured", "message": str(e)},
        ) from e
    except pinelabs.MandateRequiredError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "mandate_required", "message": "No active UPI mandate"},
        ) from e
    except ServerP3PError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, {"code": e.code, "message": str(e)}
        ) from e


def _out(db: Session, mandate: UpiMandate) -> UpiMandateResponse:
    return UpiMandateResponse(
        **mandate.model_dump(), amount_available=pinelabs.available(db, mandate)
    )


@router.post("/mandates", status_code=status.HTTP_201_CREATED)
def create_mandate(body: CreateUpiMandateRequest, db: DB) -> UpiMandateResponse:
    """Block an amount on the customer's UPI account."""
    days = body.validity_days or get_payment_settings().upi_mandate_validity_days
    with _pinelabs_errors():
        return _out(db, pinelabs.create_mandate(db, body.mobile, body.amount, days))


@router.get("/mandates")
def get_active_mandate(
    mobile: Annotated[Mobile, Query()], db: DB
) -> UpiMandateResponse:
    """The customer's active mandate, or 404 mandate_required."""
    with _pinelabs_errors():
        mandate = pinelabs.active_mandate(db, mobile)
    if mandate is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            {"code": "mandate_required", "message": "No active UPI mandate"},
        )
    return _out(db, mandate)


@router.get("/mandates/{mandate_id}")
def get_mandate(mandate_id: str, db: DB) -> UpiMandateResponse:
    """A mandate with its status refreshed from Pine Labs."""
    mandate = db.get(UpiMandate, mandate_id)
    if mandate is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            {"code": "mandate_not_found", "message": "Unknown mandate"},
        )
    with _pinelabs_errors():
        return _out(db, pinelabs.refresh_mandate(db, mandate))


@router.post("/pay")
def pay(body: UpiPayRequest, db: DB) -> dict[str, Any]:
    """Pay a checkout session: paid, pending, refused (policy) or failed."""
    with _pinelabs_errors():
        return pinelabs.pay(db, body.checkout_session_id, body.mobile)
