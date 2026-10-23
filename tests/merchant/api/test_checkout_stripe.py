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

"""Tests for Stripe PaymentIntent verification on checkout completion."""

from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from src.data.product_catalog import PRODUCTS
from src.merchant.config import get_settings
from src.merchant.db.database import get_engine
from src.merchant.db.models import CheckoutSession, EventSession
from src.merchant.services import stripe_payments
from src.merchant.services.stripe_payments import (
    StripePaymentError,
    StripePaymentIntent,
)

PI_ID = "pi_test123"


@dataclass
class FakeStripe:
    intent: StripePaymentIntent | None = None
    capture_error: str | None = None
    captured: list[str] = field(default_factory=lambda: [])
    canceled: list[str] = field(default_factory=lambda: [])

    def retrieve(self, payment_intent_id: str) -> StripePaymentIntent:
        assert self.intent is not None
        assert payment_intent_id == self.intent.id
        return self.intent

    def capture(self, payment_intent_id: str) -> StripePaymentIntent:
        if self.capture_error:
            raise StripePaymentError(self.capture_error)
        self.captured.append(payment_intent_id)
        assert self.intent is not None
        return self.intent

    def cancel(self, payment_intent_id: str) -> None:
        self.canceled.append(payment_intent_id)


@pytest.fixture
def fake_stripe(monkeypatch: pytest.MonkeyPatch) -> Generator[FakeStripe, None, None]:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    get_settings.cache_clear()
    fake = FakeStripe()
    monkeypatch.setattr(stripe_payments, "retrieve_payment_intent", fake.retrieve)
    monkeypatch.setattr(stripe_payments, "capture_payment_intent", fake.capture)
    monkeypatch.setattr(stripe_payments, "cancel_payment_intent", fake.cancel)
    yield fake
    get_settings.cache_clear()


def _event_session_id() -> str:
    product = next((entry for entry in PRODUCTS if entry.get("sessions")), None)
    if product is None:
        pytest.skip("catalogue has no performances")
    return str(product["sessions"][0]["id"])


def _ready_session(auth_client: TestClient) -> dict[str, Any]:
    response = auth_client.post(
        "/checkout_sessions",
        json={
            "items": [{"id": _event_session_id(), "quantity": 1}],
            "buyer": {"first_name": "Ada", "email": "ada@example.com"},
        },
    )
    data: dict[str, Any] = response.json()
    assert data["status"] == "ready_for_payment"
    return data


def _total(session: dict[str, Any]) -> int:
    return next(t["amount"] for t in session["totals"] if t["type"] == "total")


def _intent(session: dict[str, Any], **overrides: Any) -> StripePaymentIntent:
    values: dict[str, Any] = {
        "id": PI_ID,
        "status": "requires_capture",
        "amount": _total(session),
        "currency": session["currency"],
        "metadata": {"checkout_session_id": session["id"]},
    }
    values.update(overrides)
    return StripePaymentIntent(**values)


def _complete(auth_client: TestClient, session_id: str, token: str = PI_ID) -> Any:
    return auth_client.post(
        f"/checkout_sessions/{session_id}/complete",
        json={"payment_data": {"token": token, "provider": "stripe"}},
    )


def _seats_left(event_session_id: str) -> int:
    with Session(get_engine()) as db:
        event = db.get(EventSession, event_session_id)
        assert event is not None
        return event.seats_left


class TestStripeCompletion:
    def test_authorized_intent_is_captured_and_order_created(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)
        fake_stripe.intent = _intent(session)

        response = _complete(auth_client, session["id"])

        assert response.status_code == 200
        assert response.json()["status"] == "completed"
        assert fake_stripe.captured == [PI_ID]
        assert fake_stripe.canceled == []

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            ({"amount": 1}, "amount"),
            ({"currency": "usd"}, "amount"),
            ({"status": "requires_payment_method"}, "not authorized"),
        ],
    )
    def test_mismatched_intent_is_rejected_and_released(
        self,
        auth_client: TestClient,
        fake_stripe: FakeStripe,
        overrides: dict[str, Any],
        message: str,
    ) -> None:
        session = _ready_session(auth_client)
        fake_stripe.intent = _intent(session, **overrides)

        response = _complete(auth_client, session["id"])

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_payment"
        assert message in response.json()["detail"]["message"]
        assert fake_stripe.captured == []
        expected_cancel = [PI_ID] if overrides.get("status") is None else []
        assert fake_stripe.canceled == expected_cancel

    def test_intent_for_another_session_is_rejected_untouched(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)
        fake_stripe.intent = _intent(
            session, metadata={"checkout_session_id": "checkout_other"}
        )

        response = _complete(auth_client, session["id"])

        assert response.status_code == 400
        assert fake_stripe.captured == []
        assert fake_stripe.canceled == []

    def test_capture_failure_leaves_session_and_seats_unchanged(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)
        event_id = session["line_items"][0]["item"]["id"]
        seats = _seats_left(event_id)
        fake_stripe.intent = _intent(session)
        fake_stripe.capture_error = "Your card was declined."

        response = _complete(auth_client, session["id"])

        assert response.status_code == 400
        assert response.json()["detail"]["message"] == "Your card was declined."
        assert _seats_left(event_id) == seats
        fetched = auth_client.get(f"/checkout_sessions/{session['id']}").json()
        assert fetched["status"] == "ready_for_payment"

    def test_sold_out_releases_hold(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)
        event_id = session["line_items"][0]["item"]["id"]
        seats = _seats_left(event_id)
        fake_stripe.intent = _intent(session)
        with Session(get_engine()) as db:
            event = db.get(EventSession, event_id)
            assert event is not None
            event.seats_left = 0
            db.add(event)
            db.commit()

        try:
            response = _complete(auth_client, session["id"])
        finally:
            with Session(get_engine()) as db:
                event = db.get(EventSession, event_id)
                assert event is not None
                event.seats_left = seats
                db.add(event)
                db.commit()

        assert response.status_code == 400
        assert fake_stripe.captured == []
        assert fake_stripe.canceled == [PI_ID]

    def test_malformed_intent_id_is_rejected(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)

        response = _complete(auth_client, session["id"], token="pi_../../charges")

        assert response.status_code == 400
        assert fake_stripe.captured == []

    def test_unconfigured_stripe_rejects_intent(
        self, auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("STRIPE_SECRET_KEY", "")
        get_settings.cache_clear()
        session = _ready_session(auth_client)

        response = _complete(auth_client, session["id"])

        assert response.status_code == 400
        assert "not configured" in response.json()["detail"]["message"]

    def test_order_records_payment_intent(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)
        fake_stripe.intent = _intent(session)

        _complete(auth_client, session["id"])

        with Session(get_engine()) as db:
            stored = db.get(CheckoutSession, session["id"])
            assert stored is not None
            assert stored.order_json is not None
            assert PI_ID in stored.order_json

    def test_simulated_tokens_skip_stripe(
        self, auth_client: TestClient, fake_stripe: FakeStripe
    ) -> None:
        session = _ready_session(auth_client)

        response = _complete(auth_client, session["id"], token="vt_simulated")

        assert response.status_code == 200
        assert fake_stripe.captured == []
