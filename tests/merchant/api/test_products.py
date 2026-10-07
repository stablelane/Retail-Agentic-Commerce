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

"""Tests for the product list and detail endpoints."""

import pytest
from fastapi.testclient import TestClient

from src.data.product_catalog import PRODUCTS


class TestListProducts:
    """Test suite for GET /products."""

    def test_list_returns_full_catalog(self, client: TestClient) -> None:
        response = client.get("/products")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 17
        assert len(data["products"]) == 17
        assert data["category"] is None

    def test_list_is_in_catalog_order(self, client: TestClient) -> None:
        data = client.get("/products").json()

        assert [p["id"] for p in data["products"]] == [p["id"] for p in PRODUCTS]

    @pytest.mark.parametrize(
        ("category", "expected"),
        [("tops", 4), ("bottoms", 4), ("footwear", 3), ("nope", 0)],
    )
    def test_list_filters_by_category(
        self, client: TestClient, category: str, expected: int
    ) -> None:
        response = client.get("/products", params={"category": category})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == expected
        assert len(data["products"]) == expected
        assert data["category"] == category
        assert all(p["category"] == category for p in data["products"])

    def test_list_supports_limit_and_offset(self, client: TestClient) -> None:
        full = [p["id"] for p in client.get("/products").json()["products"]]

        response = client.get("/products", params={"limit": 5, "offset": 3})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 17
        assert [p["id"] for p in data["products"]] == full[3:8]

    def test_list_offset_past_end_returns_empty(self, client: TestClient) -> None:
        data = client.get("/products", params={"offset": 50}).json()

        assert data["products"] == []
        assert data["total"] == 17

    @pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
    def test_list_rejects_invalid_pagination(
        self, client: TestClient, params: dict[str, int]
    ) -> None:
        response = client.get("/products", params=params)

        assert response.status_code == 422


class TestGetProduct:
    """Test suite for GET /products/{product_id}."""

    def test_detail_includes_enrichment(self, client: TestClient) -> None:
        response = client.get("/products/prod_3")

        assert response.status_code == 200
        data = response.json()
        assert data["compare_at_price"] == 4000
        assert data["category"] == "tops"
        assert data["subcategory"] == "t-shirts"
        assert data["description"]
        assert "graphic" in data["attributes"]

    def test_detail_keeps_existing_fields(self, client: TestClient) -> None:
        data = client.get("/products/prod_3").json()

        assert data["id"] == "prod_3"
        assert data["sku"] == "TS-003"
        assert data["name"] == "Graphic Tee"
        assert isinstance(data["base_price"], int)
        assert isinstance(data["stock_count"], int)
        assert isinstance(data["min_margin"], float)
        assert data["image_url"] == "/prod_3.jpeg"

    def test_detail_without_sale_has_null_compare_at_price(
        self, client: TestClient
    ) -> None:
        data = client.get("/products/prod_1").json()

        assert data["compare_at_price"] is None

    def test_unknown_product_returns_404(self, client: TestClient) -> None:
        response = client.get("/products/prod_unknown")

        assert response.status_code == 404
