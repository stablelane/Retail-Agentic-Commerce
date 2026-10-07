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

"""Tests for deterministic order status derivation."""

from datetime import UTC, datetime, timedelta

import pytest

from src.merchant.services.order_status import derive_status
from src.merchant.services.post_purchase import ShippingStatus

STEP = 120
COMPLETED_AT = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("elapsed", "expected_status", "expected_history"),
    [
        (0, ShippingStatus.ORDER_CONFIRMED, 1),
        (STEP - 1, ShippingStatus.ORDER_CONFIRMED, 1),
        (STEP, ShippingStatus.ORDER_SHIPPED, 2),
        (2 * STEP, ShippingStatus.OUT_FOR_DELIVERY, 3),
        (3 * STEP, ShippingStatus.DELIVERED, 4),
        (10 * STEP, ShippingStatus.DELIVERED, 4),
    ],
)
def test_derive_status_steps(
    elapsed: int, expected_status: ShippingStatus, expected_history: int
) -> None:
    status, history = derive_status(
        COMPLETED_AT, COMPLETED_AT + timedelta(seconds=elapsed), STEP
    )

    assert status == expected_status
    assert len(history) == expected_history
    assert history[-1]["status"] == expected_status


def test_history_timestamps_are_spaced_by_step() -> None:
    _, history = derive_status(
        COMPLETED_AT, COMPLETED_AT + timedelta(seconds=10 * STEP), STEP
    )

    assert [event["status"] for event in history] == [
        ShippingStatus.ORDER_CONFIRMED,
        ShippingStatus.ORDER_SHIPPED,
        ShippingStatus.OUT_FOR_DELIVERY,
        ShippingStatus.DELIVERED,
    ]
    assert [datetime.fromisoformat(event["at"]) for event in history] == [
        COMPLETED_AT + timedelta(seconds=i * STEP) for i in range(4)
    ]


def test_naive_datetimes_are_treated_as_utc() -> None:
    naive_completed = COMPLETED_AT.replace(tzinfo=None)

    status, history = derive_status(
        naive_completed, COMPLETED_AT + timedelta(seconds=STEP), STEP
    )

    assert status == ShippingStatus.ORDER_SHIPPED
    assert datetime.fromisoformat(history[0]["at"]) == COMPLETED_AT


def test_now_before_completion_stays_confirmed() -> None:
    status, history = derive_status(
        COMPLETED_AT, COMPLETED_AT - timedelta(seconds=STEP), STEP
    )

    assert status == ShippingStatus.ORDER_CONFIRMED
    assert len(history) == 1
