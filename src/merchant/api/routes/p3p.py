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

"""Pine Labs P3P pay route: HTTP 402 challenge, then capture and complete (feature 20)."""

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlmodel import Session

from src.merchant.api.dependencies import verify_api_key
from src.merchant.db.database import get_session
from src.merchant.domain.checkout.models import CheckoutStatusEnum
from src.merchant.domain.checkout.service import (
    CheckoutServiceError,
    SessionNotFoundError,
    complete_checkout_session_from_data,
    get_checkout_session,
)
from src.merchant.protocols.acp.services.post_purchase_webhook import (
    trigger_post_purchase_flow,
)
from src.merchant.services.post_purchase import OrderItem
from src.merchant.services.psp import decide_upi_payment

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/p3p",
    tags=["p3p"],
    dependencies=[Depends(verify_api_key)],
)


def _error(code: int, error: CheckoutServiceError) -> HTTPException:
    return HTTPException(
        status_code=code, detail={"code": error.code, "message": error.message}
    )


@router.get(
    "/checkout_sessions/{session_id}/pay",
    summary="Pay Checkout Session with UPI (P3P)",
    responses={
        200: {
            "description": "Paid (or already paid); Payment-Receipt header on capture"
        },
        402: {"description": "P3P challenge in WWW-Authenticate"},
        404: {"description": "Checkout session not found"},
        405: {"description": "Session not ready for payment"},
    },
)
def pay_checkout(
    session_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
) -> JSONResponse:
    """Return 402 until the caller presents a P3P credential, then capture and complete."""
    try:
        current = get_checkout_session(db, session_id)
    except SessionNotFoundError as e:
        raise _error(status.HTTP_404_NOT_FOUND, e) from e

    if current.order is not None:  # idempotent: never charge a completed session twice
        return JSONResponse(current.model_dump(mode="json"))
    if current.status != CheckoutStatusEnum.READY_FOR_PAYMENT:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            detail={
                "code": "session_not_ready",
                "message": f"status is {current.status}",
            },
        )

    total = next(t.amount for t in current.totals if t.type == "total")
    decision = decide_upi_payment(
        request.headers.get("P3P-Credential"), session_id, total
    )
    if decision.action != "proceed":
        return JSONResponse(
            decision.problem_details or decision.pending_body or {},
            status_code=decision.status,
            headers=decision.headers,
        )

    capture: dict[str, Any] = dict(decision.capture_result or {})
    token = str(capture.get("id") or decision.receipt_header or session_id)
    try:
        response = complete_checkout_session_from_data(
            db, session_id, payment_data={"token": token, "provider": "pinelabs"}
        )
    except CheckoutServiceError as e:
        # ponytail: money captured but seats sold out in between; refund by hand
        # (server SDK create_refund) until it happens outside a demo.
        logger.error(f"P3P captured {token} but completing {session_id} failed: {e}")
        raise _error(status.HTTP_409_CONFLICT, e) from e

    if response.order is not None:
        items: list[OrderItem] = [
            {"name": line.name or line.item.id, "quantity": line.item.quantity}
            for line in response.line_items or []
        ] or [{"name": "your order", "quantity": 1}]
        background_tasks.add_task(
            trigger_post_purchase_flow,
            checkout_session_id=session_id,
            order_id=response.order.id,
            customer_name=(response.buyer and response.buyer.first_name) or "Customer",
            items=items,
            language="en",
        )
    return JSONResponse(response.model_dump(mode="json"), headers=decision.headers)
