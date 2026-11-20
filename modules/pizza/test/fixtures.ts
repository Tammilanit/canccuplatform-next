/** The contract's two CSV examples (the step 5 plan), byte for byte; placeholders only. */

/** The menu import's example. */
export const SPEC_MENU = [
  "pizzeria,phone,website,service,kind,number,name,description,price",
  'Demo Trattoria,+000 000 0000,https://trattoria.example,delivery,item,4,Margherita,"tomato, mozzarella",8.00',
  'Demo Trattoria,,,,item,7,Funghi,"mushroom, mozzarella",8.50',
  'Demo Trattoria,,,,item,12,Kebab,"kebab, onion, chili",9.50',
  'Demo Trattoria,,,,base,,Own pizza,"tomato, mozzarella",7.00',
  "Demo Trattoria,,,,topping,,Olives,,1.00",
  'Demo Corner Grill,+000 000 0001,,takeaway,item,1,Demo Burger,"bun, patty, salad",',
  "",
].join("\n");

/** The export's example: the orders of mockups 09, 12 and 19. */
export const SPEC_EXPORT = [
  "order_id,ordered_at,pizzeria,payer_nick,order_total,settle_to,nick,discord_id,units,amount",
  "2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Demo Player,,2,",
  "2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Player Five,,2,",
  "2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Player Six,,1,",
  "2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Player Two,,1,",
  "2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Demo Player,,2,20.00",
  "2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Player Four,,2,17.00",
  "2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Player Three,,1,9.00",
  "2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Player Two,,1,8.50",
  "",
].join("\n");

