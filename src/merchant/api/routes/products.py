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

"""Product list and lookup endpoints for the Agentic Commerce middleware."""

from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from src.merchant.db.database import get_session
from src.merchant.db.models import EventSession, Product
from src.merchant.services.catalog_metadata import (
    get_catalog_metadata,
    get_catalog_position,
)

DUBAI = ZoneInfo("Asia/Dubai")

router = APIRouter(tags=["products"])


class SessionResponse(BaseModel):
    """One bookable performance."""

    id: str
    starts_at: str
    seats_left: int


class ProductResponse(BaseModel):
    """Product response schema enriched with catalog metadata."""

    id: str
    sku: str
    name: str
    base_price: int
    compare_at_price: int | None = None
    stock_count: int
    min_margin: float
    image_url: str
    category: str | None = None
    subcategory: str | None = None
    description: str | None = None
    attributes: list[str] = Field(default_factory=list)
    venue: str | None = None
    sessions: list[SessionResponse] = Field(default_factory=list)


class ProductListResponse(BaseModel):
    """Paginated product list response."""

    products: list[ProductResponse]
    total: int
    category: str | None = None


def _as_dubai(value: datetime) -> datetime:
    """SQLite keeps the Dubai wall clock and drops the offset."""
    if value.tzinfo is None:
        return value.replace(tzinfo=DUBAI)
    return value.astimezone(DUBAI)


def _on_dubai_day(starts_at: datetime, day: str) -> bool:
    local = _as_dubai(starts_at).astimezone(DUBAI)
    return local.date().isoformat() == day


def _in_dubai_range(starts_at: datetime, start: str | None, end: str | None) -> bool:
    local_day = _as_dubai(starts_at).astimezone(DUBAI).date().isoformat()
    if start is not None and local_day < start:
        return False
    return end is None or local_day <= end


def _parse_day(value: str, field: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{field} must be YYYY-MM-DD"
        ) from exc
    return value


def _sessions_by_product(db: Session) -> dict[str, list[EventSession]]:
    grouped: dict[str, list[EventSession]] = {}
    for row in db.exec(select(EventSession)).all():
        grouped.setdefault(row.product_id, []).append(row)
    for rows in grouped.values():
        rows.sort(key=lambda row: _as_dubai(row.starts_at))
    return grouped


def _to_response(product: Product, sessions: list[EventSession]) -> ProductResponse:
    metadata = get_catalog_metadata(product.id)
    return ProductResponse(
        id=product.id,
        sku=product.sku,
        name=product.name,
        base_price=product.base_price,
        compare_at_price=metadata["compare_at_price_cents"],
        stock_count=product.stock_count,
        min_margin=product.min_margin,
        image_url=product.image_url,
        category=metadata["category"],
        subcategory=metadata["subcategory"],
        description=metadata["description"],
        attributes=metadata["attributes"],
        venue=product.venue or metadata["venue"],
        sessions=[
            SessionResponse(
                id=row.id,
                starts_at=_as_dubai(row.starts_at).astimezone(DUBAI).isoformat(),
                seats_left=row.seats_left,
            )
            for row in sessions
        ],
    )


@router.get("/products", response_model=ProductListResponse)
def list_products(
    db: Session = Depends(get_session),
    category: str | None = None,
    date: str | None = None,
    date_from: Annotated[str | None, Query(alias="from")] = None,
    date_to: Annotated[str | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProductListResponse:
    """List products in catalog order, optionally filtered by category or date."""
    if date is not None:
        date = _parse_day(date, "date")
    if date_from is not None:
        date_from = _parse_day(date_from, "from")
    if date_to is not None:
        date_to = _parse_day(date_to, "to")
    grouped = _sessions_by_product(db)
    products = [
        _to_response(product, grouped.get(product.id, []))
        for product in db.exec(select(Product)).all()
    ]
    if category is not None:
        products = [p for p in products if p.category == category]
    if date is not None:
        products = [
            p
            for p in products
            if any(_on_dubai_day(datetime.fromisoformat(s.starts_at), date) for s in p.sessions)
        ]
    elif date_from is not None or date_to is not None:
        products = [
            p
            for p in products
            if any(
                _in_dubai_range(datetime.fromisoformat(s.starts_at), date_from, date_to)
                for s in p.sessions
            )
        ]
    products.sort(key=lambda p: (get_catalog_position(p.id), p.id))
    return ProductListResponse(
        products=products[offset : offset + limit],
        total=len(products),
        category=category,
    )


@router.get("/products/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: str,
    db: Session = Depends(get_session),
) -> ProductResponse:
    """Retrieve a product by its ID.

    Args:
        product_id: The unique product identifier (e.g., "prod_1").
        db: Database session (injected).

    Returns:
        ProductResponse: Product details including price, stock, and image.

    Raises:
        HTTPException: 404 if product not found.
    """
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    sessions = db.exec(
        select(EventSession).where(EventSession.product_id == product.id)
    ).all()
    sessions.sort(key=lambda row: _as_dubai(row.starts_at))
    return _to_response(product, list(sessions))
