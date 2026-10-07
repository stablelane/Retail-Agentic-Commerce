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

"""Tests for the order status lookup endpoint."""

from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from src.merchant.config import get_settings

BUYER_EMAIL = "orders@example.com"


@pytest.fixture(autouse=True)
def mock_post_purchase_flow() -> Generator[AsyncMock, None, None]:
    with patch(
        "src.merchant.protocols.acp.api.routes.checkout.trigger_post_purchase_flow",
        new_callable=AsyncMock,
    ) as mock:
        yield mock


def _complete_order(auth_client: TestClient) -> dict[str, Any]:
    create_response = auth_client.post(
        "/checkout_sessions",
        json={
            "items": [{"id": "prod_1", "quantity": 1}],
            "buyer": {"first_name": "Order", "email": BUYER_EMAIL},
            "fulfillment_address": {
                "name": "Order User",
                "line_one": "100 Order St",
                "city": "Order City",
                "state": "CA",
                "country": "US",
                "postal_code": "94102",
            },
        },
    )
    session_id = create_response.json()["id"]
    fulfillment_option_id = create_response.json()["fulfillment_options"][0]["id"]
    auth_client.post(
        f"/checkout_sessions/{session_id}",
        json={"fulfillment_option_id": fulfillment_option_id},
    )
    complete_response = auth_client.post(
        f"/checkout_sessions/{session_id}/complete",
        json={"payment_data": {"token": "tok_test", "provider": "stripe"}},
    )
    assert complete_response.status_code == 200
    return complete_response.json()


class TestGetOrder:
    """Test suite for GET /orders/{order_id}."""

    def test_returns_order_status(self, auth_client: TestClient) -> None:
        session = _complete_order(auth_client)
        order_id = session["order"]["id"]

        response = auth_client.get(f"/orders/{order_id}", params={"email": BUYER_EMAIL})

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == order_id
        assert data["checkout_session_id"] == session["id"]
        assert data["permalink_url"] == session["order"]["permalink_url"]
        assert data["status"] == "order_confirmed"
        assert len(data["status_history"]) == 1
        assert data["status_history"][0]["status"] == "order_confirmed"
        assert data["tracking_url"] == (
            f"{get_settings().order_tracking_base_url}/{order_id}"
        )
        assert data["buyer"]["email"] == BUYER_EMAIL
        assert data["line_items"][0]["item"]["id"] == "prod_1"
        assert any(t["type"] == "total" for t in data["totals"])
        assert data["fulfillment_address"]["name"] == "Order User"
        assert data["fulfillment"]["option_id"] == session["fulfillment_option_id"]
        assert (
            data["estimated_delivery"] == (data["fulfillment"]["latest_delivery_time"])
        )
        assert data["placed_at"]

    def test_email_match_is_case_insensitive(self, auth_client: TestClient) -> None:
        order_id = _complete_order(auth_client)["order"]["id"]

        response = auth_client.get(
            f"/orders/{order_id}", params={"email": BUYER_EMAIL.upper()}
        )

        assert response.status_code == 200

    def test_wrong_email_returns_404(self, auth_client: TestClient) -> None:
        order_id = _complete_order(auth_client)["order"]["id"]

        response = auth_client.get(
            f"/orders/{order_id}", params={"email": "nobody@example.com"}
        )

        assert response.status_code == 404
        detail = response.json()["detail"]
        assert detail["type"] == "not_found"
        assert detail["code"] == "order_not_found"

    def test_unknown_order_returns_404(self, auth_client: TestClient) -> None:
        response = auth_client.get(
            "/orders/order_does_not_exist", params={"email": BUYER_EMAIL}
        )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "order_not_found"

    def test_missing_email_returns_422(self, auth_client: TestClient) -> None:
        response = auth_client.get("/orders/order_any")

        assert response.status_code == 422

    def test_requires_authentication(self, client: TestClient) -> None:
        response = client.get("/orders/order_any", params={"email": BUYER_EMAIL})

        assert response.status_code == 401
