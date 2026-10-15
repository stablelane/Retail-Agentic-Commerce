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

"""Pine Labs P3P payee side: 402 challenge, credential verification, capture."""

import logging
from functools import lru_cache

from pinelabs_p3p_server import (
    Amount,
    ChargeOptions,
    P3PEnvironment,
    PaymentGateway,
    PaymentMethod,
    PineLabsOnlineServerConfig,
    decide_payment,
)
from pinelabs_p3p_server.server.middleware.generic import PaymentDecision

from src.merchant.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def _config() -> PineLabsOnlineServerConfig:
    settings = get_settings()
    if not settings.pinelabs_client_id:
        logger.warning("PINELABS_* not set: P3P challenges work, captures will fail")
    return PineLabsOnlineServerConfig(
        clientId=settings.pinelabs_client_id or "unset",
        clientSecret=settings.pinelabs_client_secret or "unset",
        merchantId=settings.pinelabs_merchant_id or "unset",
        env=P3PEnvironment.SANDBOX,
        paymentGateway=PaymentGateway.PineLabsOnline,
        availablePaymentMethods=[PaymentMethod.RESERVE_PAY],
    )


def decide_upi_payment(
    credential_header: str | None, session_id: str, total: int
) -> PaymentDecision:
    """402 until a P3P credential arrives, then verify and capture via Pine Labs.

    The total is the session's AED minor-unit integer, labelled INR unconverted
    because the Pine Labs sandbox is INR only (feature 20, decisions).
    """
    return decide_payment(
        credential_header=credential_header,
        config=_config(),
        charge_options=ChargeOptions(
            amount=Amount(value=total, currency="INR"),
            resource=f"/p3p/checkout_sessions/{session_id}/pay",
            merchantOrderReference=session_id,
            description=f"{get_settings().brand_name} order {session_id}",
        ),
    )
