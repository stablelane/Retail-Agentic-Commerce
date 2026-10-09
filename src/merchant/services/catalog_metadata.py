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

"""Catalog metadata index used to enrich product API responses."""

from typing import TypedDict

from src.data.product_catalog import PRODUCTS, ProductData

_INDEX: dict[str, ProductData] = {product["id"]: product for product in PRODUCTS}
_POSITIONS: dict[str, int] = {
    product["id"]: position for position, product in enumerate(PRODUCTS)
}
_CATEGORIES: list[str] = list(
    dict.fromkeys(product["category"] for product in PRODUCTS)
)


class CatalogMetadata(TypedDict):
    """Catalog fields not stored on the `Product` table."""

    category: str | None
    subcategory: str | None
    description: str | None
    attributes: list[str]
    compare_at_price_cents: int | None
    venue: str | None


def get_catalog_metadata(product_id: str) -> CatalogMetadata:
    """Return catalog metadata for a product, with empty values if unknown."""
    product = _INDEX.get(product_id)
    if product is None:
        return CatalogMetadata(
            category=None,
            subcategory=None,
            description=None,
            attributes=[],
            compare_at_price_cents=None,
            venue=None,
        )
    return CatalogMetadata(
        category=product["category"],
        subcategory=product["subcategory"],
        description=product["description"],
        attributes=list(product["attributes"]),
        compare_at_price_cents=product.get("compare_at_price_cents"),
        venue=product.get("venue") or None,
    )


def get_catalog_position(product_id: str) -> int:
    """Return the catalog ordering position; unknown products sort last."""
    return _POSITIONS.get(product_id, len(_POSITIONS))


def get_product_ids_in_category(category: str | None) -> list[str]:
    """Return product ids in catalog order, optionally filtered by category."""
    return [
        product["id"]
        for product in PRODUCTS
        if category is None or product["category"] == category
    ]


def list_categories() -> list[str]:
    """Return categories in catalog order."""
    return list(_CATEGORIES)
