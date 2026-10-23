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

"""Minimal Stripe PaymentIntent client used to verify and capture checkout payments."""

import logging
from dataclasses import dataclass
from typing import Any, cast

import httpx

from src.merchant.config import get_settings

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_TIMEOUT_SECONDS = 15.0


class StripePaymentError(Exception):
    """Raised when Stripe is unreachable, misconfigured, or rejects a request."""


@dataclass(frozen=True)
class StripePaymentIntent:
    """The PaymentIntent fields the merchant relies on."""

    id: str
    status: str
    amount: int
    currency: str
    metadata: dict[str, str]


def is_stripe_configured() -> bool:
    return bool(get_settings().stripe_secret_key.strip())


def _request(
    method: str, path: str, *, idempotency_key: str | None = None
) -> StripePaymentIntent:
    secret_key = get_settings().stripe_secret_key.strip()
    if not secret_key:
        raise StripePaymentError("Stripe is not configured")

    headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
    try:
        response = httpx.request(
            method,
            f"{STRIPE_API_BASE}{path}",
            auth=(secret_key, ""),
            headers=headers,
            timeout=STRIPE_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as e:
        logger.error(f"Stripe request failed | {method} {path} | {e}")
        raise StripePaymentError("Payment provider is unavailable") from e

    payload = cast(dict[str, Any], response.json())
    if response.status_code >= 400:
        error = cast(dict[str, Any], payload.get("error") or {})
        message = str(error.get("message") or "Payment provider rejected the request")
        logger.warning(
            f"Stripe error | {method} {path} | status={response.status_code} | "
            f"code={error.get('code')}"
        )
        raise StripePaymentError(message)

    metadata = cast(dict[str, Any], payload.get("metadata") or {})
    return StripePaymentIntent(
        id=str(payload["id"]),
        status=str(payload["status"]),
        amount=int(payload["amount"]),
        currency=str(payload["currency"]),
        metadata={str(k): str(v) for k, v in metadata.items()},
    )


def retrieve_payment_intent(payment_intent_id: str) -> StripePaymentIntent:
    return _request("GET", f"/payment_intents/{payment_intent_id}")


def capture_payment_intent(payment_intent_id: str) -> StripePaymentIntent:
    return _request(
        "POST",
        f"/payment_intents/{payment_intent_id}/capture",
        idempotency_key=f"capture-{payment_intent_id}",
    )


def cancel_payment_intent(payment_intent_id: str) -> None:
    """Release an authorization hold; failures are logged, never raised."""
    try:
        _request(
            "POST",
            f"/payment_intents/{payment_intent_id}/cancel",
            idempotency_key=f"cancel-{payment_intent_id}",
        )
    except StripePaymentError:
        logger.exception(f"Failed to release Stripe hold {payment_intent_id}")
