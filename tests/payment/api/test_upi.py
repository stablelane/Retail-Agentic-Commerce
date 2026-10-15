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

"""Tests for the UPI wallet (feature 20). Offline: Pine Labs is faked."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pinelabs_p3p_client.client.credential_builder import decode_challenge
from pinelabs_p3p_client.types.challenge import Challenge
from sqlmodel import Session, col, delete

from src.merchant.services.psp import decide_upi_payment
from src.payment.config import get_payment_settings
from src.payment.db.database import get_engine, init_payment_tables
from src.payment.db.models import UpiDebit, UpiMandate
from src.payment.services import pinelabs

MOBILE = "9000000001"


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch) -> Generator[Session, None, None]:
    for key in ("PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_MERCHANT_ID"):
        monkeypatch.setenv(key, "")
    monkeypatch.setenv("UPI_MAX_PER_TXN", "500000")
    monkeypatch.setenv("UPI_DAILY_BUDGET", "1000000")
    get_payment_settings.cache_clear()
    init_payment_tables()
    with Session(get_engine()) as session:

        def wipe() -> None:
            session.exec(delete(UpiDebit).where(col(UpiDebit.mobile) == MOBILE))  # type: ignore[call-overload]
            session.exec(delete(UpiMandate).where(col(UpiMandate.mobile) == MOBILE))  # type: ignore[call-overload]
            session.commit()

        wipe()
        yield session
        wipe()
    get_payment_settings.cache_clear()


@pytest.fixture
def fake_pinelabs(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_MERCHANT_ID"):
        monkeypatch.setenv(key, "sandbox_x")
    get_payment_settings.cache_clear()
    created = SimpleNamespace(
        mandate_id="mdt_test_1", payment_status="CREATED", challenge=None
    )
    server = SimpleNamespace(
        create_mandate=lambda _opts: created,
        get_mandate=lambda _id: SimpleNamespace(payment_status="ACTIVE"),
    )
    monkeypatch.setattr(pinelabs, "_server", lambda: server)


def _mandate(db: Session, amount: int) -> UpiMandate:
    mandate = UpiMandate(
        id="mdt_test_guard",
        mobile=MOBILE,
        amount=amount,
        status="ACTIVE",
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    db.add(mandate)
    db.commit()
    return mandate


def _challenge(amount: int) -> Challenge:
    header = decide_upi_payment(None, "checkout_guard", amount).headers[
        "WWW-Authenticate"
    ]
    return decode_challenge(header)


def test_guard_enforces_caps_and_reserves(db: Session) -> None:
    mandate = _mandate(db, amount=900_000)

    with pytest.raises(pinelabs.LimitExceededError, match="per-payment cap"):
        pinelabs.make_guard(db, mandate, "checkout_a")(_challenge(500_001))

    pinelabs.make_guard(db, mandate, "checkout_a")(_challenge(400_000))
    debit = db.get(UpiDebit, "checkout_a")
    assert debit is not None and debit.amount == 400_000 and debit.status == "reserved"

    # Retrying the same session replaces its reservation instead of counting twice.
    pinelabs.make_guard(db, mandate, "checkout_a")(_challenge(400_000))
    assert pinelabs.spent_today(db, MOBILE) == 400_000

    pinelabs.make_guard(db, mandate, "checkout_b")(_challenge(400_000))
    with pytest.raises(pinelabs.LimitExceededError, match="left on the UPI mandate"):
        pinelabs.make_guard(db, mandate, "checkout_c")(_challenge(100_001))


def test_guard_enforces_daily_budget(db: Session) -> None:
    mandate = _mandate(db, amount=5_000_000)
    for session_id in ("checkout_d1", "checkout_d2"):
        pinelabs.make_guard(db, mandate, session_id)(_challenge(500_000))
    with pytest.raises(pinelabs.LimitExceededError, match="remaining budget"):
        pinelabs.make_guard(db, mandate, "checkout_d3")(_challenge(1_000))
    assert db.get(UpiDebit, "checkout_d3") is None


@pytest.mark.usefixtures("db", "fake_pinelabs")
def test_mandate_lifecycle(psp_auth_client: TestClient) -> None:
    missing = psp_auth_client.get("/upi/mandates", params={"mobile": MOBILE})
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "mandate_required"

    created = psp_auth_client.post(
        "/upi/mandates", json={"mobile": MOBILE, "amount": 200_000}
    )
    assert created.status_code == 201
    assert created.json()["status"] == "CREATED"

    active = psp_auth_client.get("/upi/mandates", params={"mobile": MOBILE})
    assert active.status_code == 200
    assert active.json()["status"] == "ACTIVE"
    assert active.json()["amount_available"] == 200_000


def test_create_mandate_rejects_bad_mobile(psp_auth_client: TestClient) -> None:
    response = psp_auth_client.post(
        "/upi/mandates", json={"mobile": "12345", "amount": 100}
    )
    assert response.status_code == 422


@pytest.mark.usefixtures("db")
def test_pay_without_credentials_returns_503(psp_auth_client: TestClient) -> None:
    response = psp_auth_client.post(
        "/upi/pay", json={"checkout_session_id": "checkout_x", "mobile": MOBILE}
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "pinelabs_not_configured"


@pytest.mark.usefixtures("db", "fake_pinelabs")
def test_pay_without_mandate_returns_409(psp_auth_client: TestClient) -> None:
    response = psp_auth_client.post(
        "/upi/pay", json={"checkout_session_id": "checkout_x", "mobile": MOBILE}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "mandate_required"


def test_upi_routes_require_api_key(psp_client: TestClient) -> None:
    assert psp_client.get("/upi/mandates", params={"mobile": MOBILE}).status_code == 401
