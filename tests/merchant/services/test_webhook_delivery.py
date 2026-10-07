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

"""Tests for ACP webhook delivery fan-out."""

from collections.abc import Callable, Generator
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from src.merchant.protocols.acp.services.webhook_delivery import (
    WebhookEvent,
    send_webhook,
)

UI_URL = "http://ui.test/api/webhooks/acp"
STOREFRONT_URL = "http://storefront.test/api/webhooks/acp"

EVENT: WebhookEvent = {
    "type": "order_created",
    "data": {
        "type": "order",
        "order_id": "order_1",
        "checkout_session_id": "checkout_1",
        "permalink_url": "https://shop.test/orders/order_1",
        "status": "created",
        "refunds": [],
    },
}

Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def requests_seen() -> list[httpx.Request]:
    return []


@pytest.fixture
def install_transport(
    requests_seen: list[httpx.Request],
) -> Generator[Callable[[Handler], None], None, None]:
    real_async_client = httpx.AsyncClient
    holder: dict[str, Handler] = {}

    def recording_handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        return holder["handler"](request)

    def client_factory(**kwargs: Any) -> httpx.AsyncClient:
        return real_async_client(
            transport=httpx.MockTransport(recording_handler), **kwargs
        )

    def install(handler: Handler) -> None:
        holder["handler"] = handler

    with patch(
        "src.merchant.protocols.acp.services.webhook_delivery.httpx.AsyncClient",
        side_effect=client_factory,
    ):
        yield install


async def test_single_url_delivers(
    install_transport: Callable[[Handler], None],
    requests_seen: list[httpx.Request],
) -> None:
    install_transport(lambda _request: httpx.Response(200))

    result = await send_webhook(EVENT, webhook_url=UI_URL, webhook_secret="secret")

    assert result is True
    assert [str(r.url) for r in requests_seen] == [UI_URL]
    assert requests_seen[0].headers["X-Webhook-Signature"]


async def test_fan_out_succeeds_when_one_target_fails(
    install_transport: Callable[[Handler], None],
    requests_seen: list[httpx.Request],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == UI_URL:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200)

    install_transport(handler)

    result = await send_webhook(
        EVENT,
        webhook_url=f" {UI_URL} , {STOREFRONT_URL},, ",
        webhook_secret="secret",
    )

    assert result is True
    assert [str(r.url) for r in requests_seen] == [UI_URL, STOREFRONT_URL]
    assert requests_seen[0].content == requests_seen[1].content
    assert (
        requests_seen[0].headers["X-Webhook-Signature"]
        == requests_seen[1].headers["X-Webhook-Signature"]
    )


async def test_fan_out_fails_when_all_targets_fail(
    install_transport: Callable[[Handler], None],
    requests_seen: list[httpx.Request],
) -> None:
    install_transport(lambda _request: httpx.Response(500))

    result = await send_webhook(
        EVENT,
        webhook_url=f"{UI_URL},{STOREFRONT_URL}",
        webhook_secret="secret",
    )

    assert result is False
    assert len(requests_seen) == 2


async def test_blank_url_list_skips_delivery(
    install_transport: Callable[[Handler], None],
    requests_seen: list[httpx.Request],
) -> None:
    install_transport(lambda _request: httpx.Response(200))

    result = await send_webhook(EVENT, webhook_url=" , ", webhook_secret="secret")

    assert result is False
    assert requests_seen == []
