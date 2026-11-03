"""Pizza menu with prices (demo: unrelated to issue #3)."""

MENU = {"margherita": 9.5, "salami": 11.0}


def price(name: str) -> float:
    return MENU[name]
