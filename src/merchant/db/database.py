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

"""Database connection and session management for the Agentic Commerce middleware."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, SQLModel, create_engine, select

from src.data.product_catalog import PRODUCTS
from src.merchant.config import get_settings
from src.merchant.db.models import (
    BrowseHistory,
    CompetitorPrice,
    Customer,
    EventSession,
    Product,
)

# Create engine lazily to allow settings to be loaded
_engine = None


def get_engine():
    """Get or create the database engine.

    Returns:
        Engine: SQLAlchemy engine instance.
    """
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            settings.database_url,
            echo=settings.log_sql,  # Only log SQL when explicitly enabled
            connect_args={"check_same_thread": False},
        )
    return _engine


def get_session() -> Generator[Session, None, None]:
    """Get a database session.

    Yields:
        Session: A SQLModel session for database operations.
    """
    with Session(get_engine()) as session:
        yield session


def init_db() -> None:
    """Initialize the database by creating all tables."""
    SQLModel.metadata.create_all(get_engine())


def seed_data(session: Session) -> None:
    """Seed products, performances, competitor prices and a demo shopper.

    Args:
        session: Database session for operations.
    """
    existing_product = session.exec(select(Product).limit(1)).first()
    if existing_product is not None:
        return

    for p in PRODUCTS:
        session.add(
            Product(
                id=p["id"],
                sku=p["sku"],
                name=p["name"],
                base_price=p["price_cents"],
                stock_count=p["stock_count"],
                min_margin=p["min_margin"],
                image_url=p["image_url"],
                venue=p.get("venue", ""),
                lifecycle=p["lifecycle"],
                demand_velocity=p["demand_velocity"],
            )
        )
        for performance in p.get("sessions") or []:
            # Store the Dubai wall clock. SQLite drops the offset, and readers
            # treat a naive value as Asia/Dubai.
            starts_at = datetime.fromisoformat(performance["starts_at"]).replace(tzinfo=None)
            session.add(
                EventSession(
                    id=performance["id"],
                    product_id=p["id"],
                    starts_at=starts_at,
                    seats_left=performance["seats"],
                )
            )

    session.commit()

    now = datetime.now(UTC)
    for p in PRODUCTS:
        session.add(
            CompetitorPrice(
                product_id=p["id"],
                retailer_name="Platinumlist",
                price=max(1, int(p["price_cents"] * 0.95)),
                updated_at=now,
            )
        )
        session.add(
            CompetitorPrice(
                product_id=p["id"],
                retailer_name="Tiqets",
                price=max(1, int(p["price_cents"] * 1.05)),
                updated_at=now,
            )
        )

    session.commit()

    customer = Customer(
        id="cust_1",
        email="demo@example.com",
        name="Demo Shopper",
        created_at=datetime.now(UTC),
    )
    session.add(customer)
    session.commit()

    base_time = datetime.now(UTC)
    sample = PRODUCTS[:10] if len(PRODUCTS) >= 10 else PRODUCTS
    for index, p in enumerate(sample):
        session.add(
            BrowseHistory(
                customer_id="cust_1",
                category=p["category"],
                search_term=p["name"],
                product_id=p["id"],
                price_viewed=p["price_cents"],
                viewed_at=base_time - timedelta(days=index + 1),
            )
        )

    session.commit()


def init_and_seed_db() -> None:
    """Initialize the database and seed with initial data."""
    init_db()
    with Session(get_engine()) as session:
        seed_data(session)


def reset_engine() -> None:
    """Reset the database engine. Useful for testing."""
    global _engine
    if _engine is not None:
        _engine.dispose()
        _engine = None
