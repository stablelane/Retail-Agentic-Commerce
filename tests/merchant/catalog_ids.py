"""Bookable catalogue ids shared by API tests."""

from src.data.product_catalog import PRODUCTS


def bookable_id(index: int = 0) -> str:
    """Session id when the product has performances, otherwise the product id."""
    product = PRODUCTS[index]
    sessions = product.get("sessions") or []
    if sessions:
        return str(sessions[0]["id"])
    return product["id"]


ITEM_ID = bookable_id()
UNIT_PRICE = PRODUCTS[0]["price_cents"]
