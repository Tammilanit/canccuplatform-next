-- #789 items 4 and 6: a menu keeps each item's category (the heading it was under, whose price an
-- unpriced item took), the own pizza's included toppings and extra-topping price, and each
-- topping's tier (`special` toppings cost extra even within the included count). Columns only
-- (additive): an old menu has none of them and prices as before.
ALTER TABLE pizza_menu_entries
  ADD COLUMN category text CHECK (char_length(category) BETWEEN 1 AND 60),
  ADD COLUMN included_toppings integer CHECK (included_toppings BETWEEN 0 AND 10),
  ADD COLUMN extra_topping_cents integer CHECK (extra_topping_cents BETWEEN 0 AND 99999),
  ADD COLUMN tier text CHECK (tier IN ('normal', 'special'));
