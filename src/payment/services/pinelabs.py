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

"""UPI wallet: Pine Labs ReservePay mandates and the P3P payer side (feature 20).

Spending limits are enforced here, in the P3P onChallenge hook, before a
one-time token exists. The LLM never sees credentials or limits.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from pinelabs_p3p_client import (
    ClientRuntimeContext,
    P3PError,
    PineLabsOnlineClient,
    PineLabsOnlineClientConfig,
)
from pinelabs_p3p_client import P3PEnvironment as ClientEnvironment
from pinelabs_p3p_client import PaymentMethod as ClientPaymentMethod
from pinelabs_p3p_client.client.credential_builder import extract_amount_paise
from pinelabs_p3p_client.types.challenge import Challenge
from pinelabs_p3p_server import (
    Amount,
    CreateMandateOptions,
    P3PEnvironment,
    PaymentGateway,
    PaymentMethod,
    PineLabsOnlineP3P,
    PineLabsOnlineServerConfig,
)
from sqlmodel import Session, col, func, select

from src.payment.config import PaymentSettings, get_payment_settings
from src.payment.db.models import UpiDebit, UpiDebitStatus, UpiMandate

ACTIVE = "ACTIVE"  # Pine Labs payment_status of an approved mandate


class PineLabsNotConfiguredError(Exception):
    """PINELABS_* credentials are unset."""


class MandateRequiredError(Exception):
    """No active mandate for this mobile number."""


class LimitExceededError(Exception):
    """The wallet's spending policy refused the challenge."""


def _credentials(settings: PaymentSettings) -> tuple[str, str, str]:
    creds = (
        settings.pinelabs_client_id,
        settings.pinelabs_client_secret,
        settings.pinelabs_merchant_id,
    )
    if not all(creds):
        raise PineLabsNotConfiguredError(
            "set PINELABS_CLIENT_ID, _SECRET, _MERCHANT_ID"
        )
    return creds


def _server() -> Any:
    client_id, secret, merchant_id = _credentials(get_payment_settings())
    return PineLabsOnlineP3P.create(
        PineLabsOnlineServerConfig(
            clientId=client_id,
            clientSecret=secret,
            merchantId=merchant_id,
            env=P3PEnvironment.SANDBOX,
            paymentGateway=PaymentGateway.PineLabsOnline,
            availablePaymentMethods=[PaymentMethod.RESERVE_PAY],
        )
    )


def _rupees(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def create_mandate(
    db: Session, mobile: str, amount: int, validity_days: int
) -> UpiMandate:
    """Block `amount` paise on the customer's UPI account (sandbox auto-approves)."""
    m = _server().create_mandate(
        CreateMandateOptions(
            mobileNumber=mobile,
            customerReference=mobile,
            amount=Amount(value=amount, currency="INR"),
            paymentMethod=PaymentMethod.RESERVE_PAY,
            validityInDays=validity_days,
            description="Shopping assistant UPI reserve",
        )
    )
    mandate = UpiMandate(
        id=m.mandate_id,
        mobile=mobile,
        amount=amount,
        status=m.payment_status,
        deep_link=m.challenge.deep_link if m.challenge else None,
        expires_at=datetime.now(UTC) + timedelta(days=validity_days),
    )
    db.add(mandate)
    db.commit()
    db.refresh(mandate)
    return mandate


def refresh_mandate(db: Session, mandate: UpiMandate) -> UpiMandate:
    """Pull the latest status from Pine Labs."""
    mandate.status = _server().get_mandate(mandate.id).payment_status
    db.add(mandate)
    db.commit()
    db.refresh(mandate)
    return mandate


def active_mandate(db: Session, mobile: str) -> UpiMandate | None:
    """Newest unexpired mandate for `mobile`, refreshed until Pine Labs says ACTIVE."""
    mandate = db.exec(
        select(UpiMandate)
        .where(UpiMandate.mobile == mobile, UpiMandate.expires_at > datetime.now(UTC))
        .order_by(col(UpiMandate.created_at).desc())
    ).first()
    if mandate is not None and mandate.status != ACTIVE:
        mandate = refresh_mandate(db, mandate)
    return mandate if mandate is not None and mandate.status == ACTIVE else None


def _spent(db: Session, *conditions: Any) -> int:
    return db.exec(
        select(func.coalesce(func.sum(UpiDebit.amount), 0)).where(*conditions)
    ).one()


def spent_today(db: Session, mobile: str, exclude: str = "") -> int:
    """Paise reserved, pending or captured today (UTC) for this customer."""
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return _spent(
        db,
        UpiDebit.mobile == mobile,
        UpiDebit.created_at >= today,
        UpiDebit.id != exclude,
    )


def available(db: Session, mandate: UpiMandate, exclude: str = "") -> int:
    """Mandate amount minus what this wallet has drawn on it.

    Computed locally: the SDK reports amount_available as 0 whenever Pine Labs
    omits it, so the ledger is the trustworthy side.
    """
    return mandate.amount - _spent(
        db, UpiDebit.mandate_id == mandate.id, UpiDebit.id != exclude
    )


def make_guard(
    db: Session, mandate: UpiMandate, session_id: str
) -> Callable[[Challenge], None]:
    """P3P onChallenge hook: refuse or reserve before any token is minted."""
    settings = get_payment_settings()

    def guard(challenge: Challenge) -> None:
        paise = extract_amount_paise(challenge)
        if challenge.request.currency != "INR":
            raise LimitExceededError(
                f"currency {challenge.request.currency} not allowed"
            )
        if paise > settings.upi_max_per_txn:
            raise LimitExceededError(
                f"{_rupees(paise)} exceeds the per-payment cap of {_rupees(settings.upi_max_per_txn)}"
            )
        left_today = settings.upi_daily_budget - spent_today(
            db, mandate.mobile, session_id
        )
        if paise > left_today:
            raise LimitExceededError(
                f"{_rupees(paise)} exceeds today's remaining budget of {_rupees(left_today)}"
            )
        left_on_mandate = available(db, mandate, session_id)
        if paise > left_on_mandate:
            raise LimitExceededError(
                f"{_rupees(paise)} exceeds the {_rupees(left_on_mandate)} left on the UPI mandate"
            )
        db.merge(
            UpiDebit(
                id=session_id,
                mandate_id=mandate.id,
                mobile=mandate.mobile,
                amount=paise,
            )
        )
        db.commit()

    return guard


def _release(db: Session, session_id: str) -> None:
    debit = db.get(UpiDebit, session_id)
    if debit is not None and debit.status == UpiDebitStatus.RESERVED:
        db.delete(debit)
        db.commit()


def _mark(db: Session, session_id: str, status: UpiDebitStatus) -> None:
    debit = db.get(UpiDebit, session_id)
    if debit is not None:
        debit.status = status
        db.add(debit)
        db.commit()


def pay(db: Session, session_id: str, mobile: str) -> dict[str, Any]:
    """Pay a merchant checkout session through the P3P 402 handshake."""
    settings = get_payment_settings()
    client_id, secret, merchant_id = _credentials(settings)
    mandate = active_mandate(db, mobile)
    if mandate is None:
        raise MandateRequiredError(mobile)

    client = PineLabsOnlineClient.create(
        PineLabsOnlineClientConfig(
            env=ClientEnvironment.SANDBOX,
            clientId=client_id,
            clientSecret=secret,
            merchantId=merchant_id,
            onChallenge=make_guard(db, mandate, session_id),
        )
    )
    context = ClientRuntimeContext(
        customerReference=mobile,
        mobileNumber=mobile,
        paymentMethod=ClientPaymentMethod.RESERVE_PAY,
    )
    try:
        r: httpx.Response = client.get(  # pyright: ignore[reportUnknownMemberType]
            f"{settings.merchant_api_url}/p3p/checkout_sessions/{session_id}/pay",
            context=context,
            headers={"Authorization": f"Bearer {settings.merchant_api_key}"},
            timeout=60,  # capture runs inside the merchant request
        )
    except LimitExceededError as e:
        return {"status": "refused", "reason": str(e)}
    except P3PError as e:
        _release(db, session_id)
        return {"status": "failed", "code": e.code, "detail": str(e)}
    except (httpx.HTTPError, RuntimeError) as e:
        _release(db, session_id)
        return {"status": "failed", "code": type(e).__name__, "detail": str(e)}
    finally:
        client.close()

    body: dict[str, Any] = r.json() if r.content else {}
    if r.status_code == 202:
        _mark(db, session_id, UpiDebitStatus.PENDING)
        return {"status": "pending", "detail": body}
    if not r.is_success:
        _release(db, session_id)
        return {"status": "failed", "code": str(r.status_code), "detail": body}

    _mark(db, session_id, UpiDebitStatus.CAPTURED)
    totals: list[dict[str, Any]] = body.get("totals", [])
    total = next((t["amount"] for t in totals if t["type"] == "total"), None)
    order: dict[str, Any] = body.get("order") or {}
    return {
        "status": "paid",
        "order_id": order.get("id"),
        "receipt": r.headers.get("Payment-Receipt"),
        "total": total,
        "currency": "INR",
        "spent_today": spent_today(db, mobile),
    }
