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

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from src.merchant.db.database import get_session
from src.merchant.db.models import Product
from src.merchant.services.catalog_metadata import (
    get_catalog_metadata,
    get_catalog_position,
)

router = APIRouter(tags=["products"])


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


class ProductListResponse(BaseModel):
    """Paginated product list response."""

    products: list[ProductResponse]
    total: int
    category: str | None = None


def _to_response(product: Product) -> ProductResponse:
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
    )


@router.get("/products", response_model=ProductListResponse)
def list_products(
    db: Session = Depends(get_session),
    category: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProductListResponse:
    """List products in catalog order, optionally filtered by category."""
    products = [_to_response(product) for product in db.exec(select(Product)).all()]
    if category is not None:
        products = [p for p in products if p.category == category]
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
    return _to_response(product)
