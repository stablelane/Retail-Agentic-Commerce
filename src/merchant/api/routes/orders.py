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

"""Order status lookup endpoint for completed checkout sessions."""

import json
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, col, select

from src.merchant.api.dependencies import verify_api_key
from src.merchant.config import Settings, get_settings
from src.merchant.db.database import get_session
from src.merchant.db.models import CheckoutSession, CheckoutStatus
from src.merchant.domain.checkout.calculations import session_to_response
from src.merchant.domain.checkout.models import (
    Address,
    Buyer,
    ErrorResponse,
    ErrorResponseCodeEnum,
    ErrorTypeEnum,
    LineItem,
    ShippingFulfillmentOption,
    Total,
)
from src.merchant.services.order_status import as_utc, derive_status
from src.merchant.services.post_purchase import ShippingStatus

router = APIRouter(
    prefix="/orders",
    tags=["orders"],
    dependencies=[Depends(verify_api_key)],
)


class OrderStatusEvent(BaseModel):
    """Order status transition."""

    status: ShippingStatus
    at: str


class FulfillmentSummary(BaseModel):
    """Selected fulfillment option summary."""

    option_id: str
    title: str
    carrier_info: str | None = None
    earliest_delivery_time: str | None = None
    latest_delivery_time: str | None = None


class OrderStatusResponse(BaseModel):
    """Order status response."""

    id: str
    checkout_session_id: str
    permalink_url: str
    status: ShippingStatus
    status_history: list[OrderStatusEvent]
    placed_at: datetime
    buyer: Buyer
    line_items: list[LineItem]
    totals: list[Total]
    fulfillment_address: Address | None
    fulfillment: FulfillmentSummary | None
    tracking_url: str
    estimated_delivery: str | None


def _order_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=ErrorResponse(
            type=ErrorTypeEnum.NOT_FOUND,
            code=ErrorResponseCodeEnum.ORDER_NOT_FOUND,
            message="Order not found.",
        ).model_dump(),
    )


def _find_completed_session(db: Session, order_id: str) -> CheckoutSession | None:
    candidates = db.exec(
        select(CheckoutSession)
        .where(CheckoutSession.status == CheckoutStatus.COMPLETED)
        .where(col(CheckoutSession.order_json).is_not(None))
        .where(col(CheckoutSession.order_json).contains(order_id))
    ).all()
    for session in candidates:
        order_data: dict[str, Any] = json.loads(session.order_json or "{}")
        if order_data.get("id") == order_id:
            return session
    return None


@router.get(
    "/{order_id}",
    response_model=OrderStatusResponse,
    summary="Get Order Status",
    responses={404: {"description": "Order not found or email mismatch"}},
)
def get_order(
    order_id: str,
    email: Annotated[str, Query(min_length=1)],
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> OrderStatusResponse:
    """Look up a completed order by ID, verified against the buyer email."""
    session = _find_completed_session(db, order_id)
    if session is None:
        raise _order_not_found()

    checkout = session_to_response(session)
    if (
        checkout.order is None
        or checkout.buyer is None
        or checkout.buyer.email.strip().lower() != email.strip().lower()
    ):
        raise _order_not_found()

    placed_at = as_utc(session.updated_at)
    current, history = derive_status(
        placed_at, datetime.now(UTC), settings.order_status_step_seconds
    )

    fulfillment: FulfillmentSummary | None = None
    selected = next(
        (
            option
            for option in checkout.fulfillment_options
            if option.id == checkout.fulfillment_option_id
        ),
        None,
    )
    if isinstance(selected, ShippingFulfillmentOption):
        fulfillment = FulfillmentSummary(
            option_id=selected.id,
            title=selected.title,
            carrier_info=selected.carrier_info,
            earliest_delivery_time=selected.earliest_delivery_time,
            latest_delivery_time=selected.latest_delivery_time,
        )
    elif selected is not None:
        fulfillment = FulfillmentSummary(option_id=selected.id, title=selected.title)

    return OrderStatusResponse(
        id=checkout.order.id,
        checkout_session_id=checkout.order.checkout_session_id,
        permalink_url=checkout.order.permalink_url,
        status=current,
        status_history=[
            OrderStatusEvent(status=event["status"], at=event["at"])
            for event in history
        ],
        placed_at=placed_at,
        buyer=checkout.buyer,
        line_items=checkout.line_items,
        totals=checkout.totals,
        fulfillment_address=checkout.fulfillment_address,
        fulfillment=fulfillment,
        tracking_url=f"{settings.order_tracking_base_url}/{order_id}",
        estimated_delivery=fulfillment.latest_delivery_time if fulfillment else None,
    )
