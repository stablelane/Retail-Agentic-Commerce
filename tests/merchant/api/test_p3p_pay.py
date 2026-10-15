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

"""Tests for the Pine Labs P3P pay route (feature 20). Offline: no capture is reached."""

import pytest
from fastapi.testclient import TestClient
from pinelabs_p3p_client.client.credential_builder import (
    decode_challenge,
    extract_amount_paise,
)
from pinelabs_p3p_server.server.middleware.generic import PaymentDecision

from src.merchant.api.routes import p3p
from tests.merchant.catalog_ids import ITEM_ID

ADDRESS = {
    "name": "Pay User",
    "line_one": "1 Sheikh Zayed Rd",
    "city": "Dubai",
    "state": "DU",
    "country": "AE",
    "postal_code": "00000",
}


def _ready_session(client: TestClient) -> tuple[str, int]:
    created = client.post(
        "/checkout_sessions",
        json={
            "items": [{"id": ITEM_ID, "quantity": 1}],
            "fulfillment_address": ADDRESS,
        },
    ).json()
    data = client.post(
        f"/checkout_sessions/{created['id']}",
        json={
            "buyer": {"first_name": "Pay", "email": "pay@example.com"},
            "fulfillment_option_id": created["fulfillment_options"][0]["id"],
        },
    ).json()
    assert data["status"] == "ready_for_payment"
    total = next(t["amount"] for t in data["totals"] if t["type"] == "total")
    return data["id"], total


def test_pay_without_credential_returns_402_challenge_for_total_in_inr(
    auth_client: TestClient,
) -> None:
    session_id, total = _ready_session(auth_client)

    response = auth_client.get(f"/p3p/checkout_sessions/{session_id}/pay")

    assert response.status_code == 402
    challenge = decode_challenge(response.headers["WWW-Authenticate"])
    assert challenge.request.currency == "INR"
    assert extract_amount_paise(challenge) == total


def test_pay_unknown_session_returns_404(auth_client: TestClient) -> None:
    assert (
        auth_client.get("/p3p/checkout_sessions/checkout_nope/pay").status_code == 404
    )


def test_pay_not_ready_session_returns_405(auth_client: TestClient) -> None:
    created = auth_client.post(
        "/checkout_sessions", json={"items": [{"id": ITEM_ID, "quantity": 1}]}
    ).json()
    response = auth_client.get(f"/p3p/checkout_sessions/{created['id']}/pay")
    assert response.status_code == 405


def test_pay_requires_api_key(client: TestClient) -> None:
    assert client.get("/p3p/checkout_sessions/checkout_x/pay").status_code == 401


def test_proceed_completes_once_with_receipt(
    auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    session_id, _ = _ready_session(auth_client)
    calls: list[str | None] = []

    def fake_decide(credential: str | None, _sid: str, _total: int) -> PaymentDecision:
        calls.append(credential)
        return PaymentDecision(
            action="proceed",
            headers={"Payment-Receipt": "receipt_1"},
            receipt_header="receipt_1",
        )

    monkeypatch.setattr(p3p, "decide_upi_payment", fake_decide)
    url = f"/p3p/checkout_sessions/{session_id}/pay"

    paid = auth_client.get(url, headers={"P3P-Credential": "Payment abc"})
    assert paid.status_code == 200
    assert paid.headers["Payment-Receipt"] == "receipt_1"
    assert paid.json()["status"] == "completed"
    assert paid.json()["order"]["id"].startswith("order_")

    again = auth_client.get(url, headers={"P3P-Credential": "Payment abc"})
    assert again.status_code == 200
    assert again.json()["order"]["id"] == paid.json()["order"]["id"]
    assert calls == ["Payment abc"]  # second call never reached Pine Labs
