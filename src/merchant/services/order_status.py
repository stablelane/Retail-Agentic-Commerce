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

"""Deterministic order status derivation based on elapsed time since completion."""

from datetime import UTC, datetime, timedelta
from typing import TypedDict

from src.merchant.services.post_purchase import ShippingStatus

STEPS: list[ShippingStatus] = [
    ShippingStatus.ORDER_CONFIRMED,
    ShippingStatus.TICKETS_ISSUED,
]


class StatusEvent(TypedDict):
    """A single order status transition."""

    status: ShippingStatus
    at: str


def as_utc(value: datetime) -> datetime:
    """Normalize to aware UTC; SQLite returns naive datetimes stored as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def derive_status(
    completed_at: datetime, now: datetime, step_seconds: int
) -> tuple[ShippingStatus, list[StatusEvent]]:
    """Derive current status and history; step i is reached at i * step_seconds."""
    start = as_utc(completed_at)
    elapsed = (as_utc(now) - start).total_seconds()
    step = max(step_seconds, 1)
    idx = max(0, min(int(elapsed // step), len(STEPS) - 1))
    history = [
        StatusEvent(
            status=status,
            at=(start + timedelta(seconds=i * step)).isoformat(),
        )
        for i, status in enumerate(STEPS[: idx + 1])
    ]
    return STEPS[idx], history
